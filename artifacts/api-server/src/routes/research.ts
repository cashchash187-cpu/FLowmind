import { Router, type IRouter } from "express";
import { eq, desc, asc, and, sql } from "drizzle-orm";
import { db, researchResultsTable, sessionsTable, transcriptsTable, usageTable } from "@workspace/db";
import { isResearchAvailable, research } from "../lib/research-provider";
import { getPlanLimits } from "../lib/plans";
import { getOrCreateUsage } from "../lib/usage-helpers";
import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function getOwnedSession(sessionId: number, userId: number, isAdmin: boolean) {
  const [session] = await db.select().from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!session) return null;
  if (!isAdmin && session.userId !== userId) return null;
  return session;
}

/**
 * Pull a research-friendly query out of the recent transcript. The old
 * implementation just grabbed the last sentence — so a transcript ending in
 * "Und was können wir als Deutsche Leasing dagegen machen?" produced a
 * literal Google search for that phrase, which returned bizarre customer-
 * complaint pages instead of the actual data behind the conversation.
 *
 * Now: ask the LLM (one cheap call) to read the recent transcript and emit
 * a concise, fact-seeking web query. Falls back to a heuristic on failure.
 */
async function deriveQuery(sessionId: number): Promise<string> {
  const rows = await db
    .select({ text: transcriptsTable.text })
    .from(transcriptsTable)
    .where(eq(transcriptsTable.sessionId, sessionId))
    .orderBy(asc(transcriptsTable.startMs));

  const recent = rows.map((r) => r.text).join(" ").trim();
  if (!recent) return "Key topics from this meeting";

  // ── Heuristic fallback (also used if LLM is unavailable) ──────────────────
  function heuristic(): string {
    const tail = recent.slice(-600);
    const sentences = tail.split(/[.!?]+/).filter(Boolean);
    return (sentences[sentences.length - 1]?.trim() ?? tail).slice(0, 120);
  }

  if (!llmConfigured) return heuristic();

  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 200,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You turn the recent transcript of a business meeting into ONE short web search query (max 12 words) that would surface the FACTS the speakers actually want — numbers, dates, definitions, company info. " +
            "Drop conversational filler ('was können wir machen', 'wie sollten wir reagieren'). " +
            "Keep proper nouns, numbers and the time-frame. Match the conversation's language. " +
            "Output ONLY the raw query string, no quotes, no explanation.",
        },
        { role: "user", content: `Transcript (last 1500 chars):\n${recent.slice(-1500)}` },
      ],
    });
    const q = completion.choices[0]?.message?.content?.trim() || "";
    if (q) return q.replace(/^["']|["']$/g, "").slice(0, 200);
  } catch (err) {
    logger.warn({ err }, "[RESEARCH] LLM query derivation failed; using heuristic");
  }
  return heuristic();
}

router.get("/research", async (req, res): Promise<void> => {
  const sessionId = Number(req.query.sessionId);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "sessionId query param required" });
    return;
  }

  const session = await getOwnedSession(sessionId, req.user!.id, req.user!.isAdmin);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const rows = await db
    .select()
    .from(researchResultsTable)
    .where(
      and(
        eq(researchResultsTable.sessionId, sessionId),
        eq(researchResultsTable.userId, req.user!.id)
      )
    )
    .orderBy(desc(researchResultsTable.createdAt));

  res.json(rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    query: r.query,
    answer: r.answer,
    sources: r.sources,
    trigger: r.trigger,
    createdAt: r.createdAt,
  })));
});

router.post("/research", async (req, res): Promise<void> => {
  const user = req.user!;

  if (!isResearchAvailable()) {
    res.status(503).json({ error: "research_unavailable", message: "Research is not configured on this server." });
    return;
  }

  const { sessionId, query: rawQuery, trigger = "manual" } = req.body ?? {};
  if (!sessionId) {
    res.status(400).json({ error: "sessionId required" });
    return;
  }

  const session = await getOwnedSession(Number(sessionId), user.id, user.isAdmin);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Plan limit check — free → 0 research requests (feature gate)
  const limits = getPlanLimits(user.plan);
  if (!user.isAdmin && user.plan !== "admin") {
    if (limits.researchRequests === 0) {
      res.status(402).json({
        error: "upgrade_required",
        limitType: "feature",
        message: "Live Research requires a Pro or Business plan.",
        upgradeUrl: "/pricing",
      });
      return;
    }

    const usage = await getOrCreateUsage(user.id, user.plan);
    const used = usage.researchRequestsUsed ?? 0;
    const limit = limits.researchRequests === Infinity ? -1 : limits.researchRequests;
    if (limit !== -1 && used >= limit) {
      res.status(402).json({
        error: "upgrade_required",
        limitType: "research",
        used,
        limit,
        upgradeUrl: "/pricing",
      });
      return;
    }
  }

  // Derive query if not provided
  const query = (typeof rawQuery === "string" && rawQuery.trim())
    ? rawQuery.trim().slice(0, 200)
    : await deriveQuery(Number(sessionId));

  // Log security event (query length only, no transcript content)
  req.log.info({
    security_event: "research_query",
    trigger,
    sessionId: Number(sessionId),
    queryLength: query.length,
    userId: user.id,
  });

  let answer: string;
  let sources: { title: string; url: string; snippet: string }[];

  try {
    const result = await research(query);
    answer = result.answer;
    sources = result.sources;
  } catch (err) {
    req.log.error({ err }, "Research provider error");
    res.status(502).json({ error: "Research provider failed. Please try again." });
    return;
  }

  // Persist
  const [row] = await db.insert(researchResultsTable).values({
    sessionId: Number(sessionId),
    userId: user.id,
    query,
    answer,
    sources: sources as unknown as Record<string, unknown>[],
    trigger,
    status: "ok",
  }).returning();

  // Increment usage (best-effort)
  if (!user.isAdmin && user.plan !== "admin") {
    const usage = await getOrCreateUsage(user.id, user.plan);
    await db.update(usageTable)
      .set({ researchRequestsUsed: sql`COALESCE(research_requests_used, 0) + 1` })
      .where(eq(usageTable.id, usage.id))
      .catch((err: unknown) => req.log.error({ err }, "Failed to increment research usage"));
  }

  res.status(201).json({
    id: row.id,
    sessionId: row.sessionId,
    query: row.query,
    answer: row.answer,
    sources: row.sources,
    trigger: row.trigger,
    createdAt: row.createdAt,
  });
});

export default router;
