import { db, transcriptsTable, sessionsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { processMemo } from "./memo-agent";
import { logger } from "./logger";

/**
 * Meeting→Memory bridge — the answer to the #1 complaint about every
 * meeting notetaker on the market: "action items get captured but don't
 * move anywhere; summaries sit in a standalone app nobody returns to."
 *
 * When a session ends, this distiller reads the transcript and extracts
 * the handful of things worth REMEMBERING (not summarizing — remembering):
 *  - commitments / action items with dates → become reminders
 *  - facts about people ("Kevin übernimmt das Budget ab Juli")
 *  - project / deal facts ("Funding Port will ein Term Sheet bis Ende Q3")
 *  - decisions that future-you will want to look up
 *
 * Each item is phrased as a self-contained memo and fed through the same
 * memo agent that powers the Memory page — so meeting knowledge lands in
 * the SAME living folder/page system as spoken notes, automatically.
 */

const MIN_TRANSCRIPT_CHARS = 300;
const MAX_ITEMS = 6;

const DISTILL_PROMPT = `You read a finished meeting transcript and extract the items worth saving into the user's personal long-term memory system.

Extract UP TO ${MAX_ITEMS} items. Each item must be:
- SELF-CONTAINED: understandable months later without the transcript ("Kevin (Einkauf bei Müller GmbH) entscheidet bis 15.7. über das Leasing-Angebot" — not "er entscheidet nächste Woche").
- WORTH REMEMBERING: commitments, deadlines, decisions, facts about people/companies, numbers that matter. NOT small talk, NOT process chatter, NOT generic statements.
- In the SAME LANGUAGE as the transcript.
- Include explicit dates when the transcript implies them (resolve "nächste Woche" using the meeting date given below).

If the meeting contains nothing memory-worthy (test calls, chitchat), return an empty list — that is a GOOD answer, don't invent items.

Output ONLY JSON: { "items": ["...", "..."] }`;

export async function distillSessionToMemory(sessionId: number, userId: number): Promise<number> {
  if (!llmConfigured) return 0;

  try {
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
    if (!session) return 0;

    const rows = await db
      .select({ text: transcriptsTable.text, speakerLabel: transcriptsTable.speakerLabel })
      .from(transcriptsTable)
      .where(eq(transcriptsTable.sessionId, sessionId))
      .orderBy(asc(transcriptsTable.startMs));

    const transcript = rows.map((r) => `${r.speakerLabel}: ${r.text}`).join("\n");
    if (transcript.length < MIN_TRANSCRIPT_CHARS) {
      logger.info({ sessionId, chars: transcript.length }, "[DISTILLER] transcript too short, skipping");
      return 0;
    }

    const meetingDate = (session.createdAt ? new Date(session.createdAt) : new Date()).toISOString().slice(0, 10);
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 1500,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DISTILL_PROMPT },
        {
          role: "user",
          content:
            `Meeting date: ${meetingDate}\nMeeting title: ${session.title}\n\n` +
            `Transcript:\n${transcript.slice(0, 24_000)}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()) as { items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter((i): i is string => typeof i === "string" && i.trim().length > 10).slice(0, MAX_ITEMS)
      : [];

    if (items.length === 0) {
      logger.info({ sessionId }, "[DISTILLER] nothing memory-worthy");
      return 0;
    }

    // File each item through the memo agent SEQUENTIALLY — parallel calls
    // could both decide to create the same new page and duplicate it.
    let filed = 0;
    for (const item of items) {
      try {
        await processMemo(userId, `[Aus Meeting "${session.title}" vom ${meetingDate}] ${item.trim()}`, "meeting");
        filed++;
      } catch (err) {
        logger.warn({ err, sessionId }, "[DISTILLER] failed to file one item");
      }
    }

    logger.info({ sessionId, userId, extracted: items.length, filed }, "[DISTILLER] meeting distilled to memory");
    return filed;
  } catch (err) {
    logger.error({ err, sessionId }, "[DISTILLER] distillation failed");
    return 0;
  }
}
