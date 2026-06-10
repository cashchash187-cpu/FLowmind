import { db, memosTable, memoPagesTable, remindersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

/**
 * Memory agent — files a free-form memo into the user's living note system.
 *
 * The agent sees the memo plus an index of the user's existing folders and
 * pages. It decides: which folder, which page (existing or new), rewrites
 * the page content to integrate the new information (merge, dedupe,
 * restructure when useful), and extracts an optional date-anchored reminder.
 *
 * Design choices:
 *  - The LLM returns the FULL updated page content, not a diff. Pages are
 *    living documents; letting the model rewrite them is what keeps them
 *    tidy over time (the user's "twist": the agent keeps everything
 *    current and re-sorts when necessary).
 *  - Page content is capped (~8k chars) so a hot page can't blow the
 *    context. If a page outgrows that, the agent is told to summarize
 *    older entries — curation built into the loop.
 */

const AGENT_PROMPT = `You are the user's personal memory agent. The user records short voice/text memos; you file each one into their living note system and keep that system tidy.

You receive:
1. Today's date (for resolving relative dates like "in 5 Tagen" / "next monday").
2. The memo (verbatim, may be colloquial speech).
3. An index of the user's existing folders and pages.
4. When you choose an existing page: its full current content.

Your job (output as JSON):
- folder: pick an existing folder when one fits, otherwise create a sensible new one (short, e.g. "Privat", "Arbeit", "Finanzen", "Projekte", "Kontakte"). Match the user's language.
- pageTitle: pick the existing page that fits best, or name a new one (short noun phrase, e.g. "Geburtstage", "Q3 Zahlen", "Kevin"). Reuse pages aggressively — a birthday memo belongs on the existing "Geburtstage" page, not a new page per person.
- pageContent: the FULL new markdown content of that page with the memo's information integrated. Keep existing content (you may restructure/dedupe/tighten). Use simple markdown: a heading, bullet lists, bold for names/dates. Newest information in the right place (e.g. a birthday list stays sorted by date). If the page exceeds ~8000 chars, condense older entries.
- reminder: if the memo asks to be reminded of something, or contains a clear future commitment/deadline/birthday THIS YEAR or NEXT, output { "label": "...", "dueAtISO": "YYYY-MM-DDTHH:mm:00" } (09:00 local if no time given). Otherwise null. Label in the memo's language.
- summary: ONE short sentence in the memo's language describing what you did ("Geburtstag von Kevin am 15.7. unter Privat/Geburtstage notiert.").

Hard rules:
- All free-text output in the SAME LANGUAGE as the memo.
- NEVER drop information that exists on the page unless it is a duplicate of the new memo.
- Don't invent facts. File what was said.
- Output ONLY the JSON object, no markdown fences.

JSON shape:
{ "folder": string, "pageTitle": string, "pageContent": string, "reminder": { "label": string, "dueAtISO": string } | null, "summary": string }`;

interface AgentDecision {
  folder: string;
  pageTitle: string;
  pageContent: string;
  reminder: { label: string; dueAtISO: string } | null;
  summary: string;
}

export interface ProcessedMemo {
  memoId: number;
  page: { id: number; folder: string; title: string };
  reminder: { id: number; label: string; dueAt: string } | null;
  summary: string;
}

/** Two-step flow: 1) route (pick page) 2) merge (rewrite content). We fold
 *  both into ONE call by sending the index plus the full content of the 3
 *  most plausible pages (cheap heuristic: same-folder + recently updated).
 *  For a personal note system the index stays small, so this is fine. */
export async function processMemo(userId: number, rawText: string, source: "voice" | "text" | "meeting"): Promise<ProcessedMemo> {
  if (!llmConfigured) throw new Error("LLM not configured");

  const text = rawText.trim();
  if (!text) throw new Error("Empty memo");

  // Persist the memo first so nothing is ever lost even if the agent fails.
  const [memo] = await db.insert(memosTable).values({ userId, rawText: text, source, status: "processed" }).returning();

  try {
    // Build the index: every page (id, folder, title) + content previews.
    const pages = await db
      .select()
      .from(memoPagesTable)
      .where(eq(memoPagesTable.userId, userId))
      .orderBy(desc(memoPagesTable.updatedAt))
      .limit(100);

    const index = pages.length
      ? pages.map((p) => `- [${p.folder}] "${p.title}" (updated ${p.updatedAt.toISOString().slice(0, 10)}): ${p.content.replace(/\s+/g, " ").slice(0, 120)}`).join("\n")
      : "(no pages yet — this is the user's first memo)";

    // Include full content of the most recently updated pages so the agent
    // can merge into them without a second round-trip.
    const fullPages = pages.slice(0, 5)
      .map((p) => `=== [${p.folder}] "${p.title}" ===\n${p.content.slice(0, 8000)}`)
      .join("\n\n");

    const userMsg =
      `Today: ${new Date().toISOString().slice(0, 10)} (${new Date().toLocaleDateString("de-DE", { weekday: "long" })})\n\n` +
      `Memo (${source}):\n"${text}"\n\n` +
      `Page index:\n${index}\n\n` +
      (fullPages ? `Full content of the most recent pages (merge into one of these when it fits):\n${fullPages}` : "");

    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 4096,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: AGENT_PROMPT },
        { role: "user", content: userMsg },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const decision = JSON.parse(cleaned) as Partial<AgentDecision>;

    if (!decision.folder || !decision.pageTitle || typeof decision.pageContent !== "string") {
      throw new Error("Agent returned incomplete decision");
    }

    const folder = decision.folder.trim().slice(0, 60);
    const title = decision.pageTitle.trim().slice(0, 120);

    // Upsert the page (match on folder+title, case-insensitive-ish).
    const existing = pages.find(
      (p) => p.folder.toLowerCase() === folder.toLowerCase() && p.title.toLowerCase() === title.toLowerCase(),
    );

    let pageId: number;
    if (existing) {
      await db.update(memoPagesTable)
        .set({ content: decision.pageContent })
        .where(and(eq(memoPagesTable.id, existing.id), eq(memoPagesTable.userId, userId)));
      pageId = existing.id;
    } else {
      const [created] = await db.insert(memoPagesTable)
        .values({ userId, folder, title, content: decision.pageContent })
        .returning();
      pageId = created.id;
    }

    await db.update(memosTable).set({ pageId }).where(eq(memosTable.id, memo.id));

    // Reminder extraction — validate the date before persisting.
    let reminderOut: ProcessedMemo["reminder"] = null;
    if (decision.reminder?.label && decision.reminder?.dueAtISO) {
      const due = new Date(decision.reminder.dueAtISO);
      if (!Number.isNaN(due.getTime())) {
        const [r] = await db.insert(remindersTable)
          .values({ userId, label: decision.reminder.label.slice(0, 300), dueAt: due, memoId: memo.id })
          .returning();
        reminderOut = { id: r.id, label: r.label, dueAt: r.dueAt.toISOString() };
      }
    }

    logger.info({ userId, memoId: memo.id, folder, title, reminder: !!reminderOut }, "[MEMO-AGENT] filed memo");

    return {
      memoId: memo.id,
      page: { id: pageId, folder, title },
      reminder: reminderOut,
      summary: typeof decision.summary === "string" && decision.summary.trim()
        ? decision.summary.trim()
        : `Filed under ${folder} / ${title}.`,
    };
  } catch (err) {
    await db.update(memosTable).set({ status: "failed" }).where(eq(memosTable.id, memo.id)).catch(() => {});
    logger.error({ err, userId, memoId: memo.id }, "[MEMO-AGENT] failed to process memo");
    throw err;
  }
}
