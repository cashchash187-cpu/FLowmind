import { Router, type IRouter } from "express";
import { eq, desc, asc, and, sql } from "drizzle-orm";
import { db, researchResultsTable, sessionsTable, transcriptsTable, usageTable } from "@workspace/db";
import { isResearchAvailable, research } from "../lib/research-provider";
import { getPlanLimits } from "../lib/plans";
import { getOrCreateUsage } from "../lib/usage-helpers";
import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";
import { ensureSessionBrief, formatBriefForPrompt } from "../lib/meeting-brief";

const router: IRouter = Router();

async function getOwnedSession(sessionId: number, userId: number, isAdmin: boolean) {
  const [session] = await db.select().from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!session) return null;
  if (!isAdmin && session.userId !== userId) return null;
  return session;
}

/**
 * Read the transcript and extract a SET of research-friendly queries — one
 * per distinct fact-question or strategic angle the user is engaging with.
 * Compound questions like "Gibt es so eine Funktion am Markt? Und hat DL
 * Vorteile?" need TWO separate web searches; squeezing both into one query
 * misses half of what the speaker wants.
 *
 * Returns 1-3 queries. Heuristic fallback when the LLM is unavailable.
 */
async function deriveQueries(sessionId: number): Promise<string[]> {
  const rows = await db
    .select({ text: transcriptsTable.text })
    .from(transcriptsTable)
    .where(eq(transcriptsTable.sessionId, sessionId))
    .orderBy(asc(transcriptsTable.startMs));

  const recent = rows.map((r) => r.text).join(" ").trim();
  if (!recent) return ["Key topics from this meeting"];

  function heuristic(): string[] {
    const tail = recent.slice(-600);
    const sentences = tail.split(/[.!?]+/).filter(Boolean);
    return [(sentences[sentences.length - 1]?.trim() ?? tail).slice(0, 120)];
  }

  if (!llmConfigured) return heuristic();

  // Wave 17: feed the auto-derived session brief so query extraction has
  // real situational context — e.g. "Marcel sells leasing at DL" lets the
  // LLM pick competitor / market queries, not generic restatements of the
  // counterpart's question. Best-effort; if the brief isn't ready yet we
  // fall back to the transcript-only extraction.
  const brief = await ensureSessionBrief(sessionId, recent);
  const briefBlock = formatBriefForPrompt(brief);

  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 300,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You read a meeting transcript and extract UP TO 3 short web search queries (max 12 words each) that would surface the FACTS the speakers actually want — numbers, dates, definitions, company info, competitive landscape. " +
            "Cover EVERY distinct fact-question or strategic angle in the transcript. Compound questions get separate queries. Drop conversational filler. Keep proper nouns, numbers, time-frames. Match the transcript's language. " +
            "When a meeting brief is provided, formulate the queries from the ASSISTED USER's perspective (e.g. if they sell X at company Y, ask about competitors / pricing / customers in X — not about Y itself, which they already know). " +
            'Output ONLY a JSON object {"queries": ["q1", "q2", ...]} — 1 to 3 entries, no markdown, no explanation.',
        },
        {
          role: "user",
          content:
            (briefBlock ? `Meeting context (auto-derived):\n${briefBlock}\n\n` : "") +
            `Transcript (last 2000 chars):\n${recent.slice(-2000)}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() || "";
    if (!raw) return heuristic();
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()) as { queries?: unknown };
      if (Array.isArray(parsed.queries)) {
        const cleaned = parsed.queries
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .map((q) => q.trim().replace(/^["']|["']$/g, "").slice(0, 200))
          .slice(0, 3);
        if (cleaned.length) return cleaned;
      }
    } catch {
      // fall through
    }
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

  // Manual query → single search. No query → derive 1-3 queries that cover
  // every distinct fact-question / strategic angle in the recent transcript.
  const queries: string[] = (typeof rawQuery === "string" && rawQuery.trim())
    ? [rawQuery.trim().slice(0, 200)]
    : await deriveQueries(Number(sessionId));

  req.log.info({
    security_event: "research_query",
    trigger,
    sessionId: Number(sessionId),
    queryCount: queries.length,
    userId: user.id,
  });

  // Fire all queries in parallel — Tavily handles low single-digit
  // concurrency fine and the user gets answers in ~the time of one call.
  const results = await Promise.allSettled(queries.map((q) => research(q)));

  const persisted: typeof researchResultsTable.$inferSelect[] = [];
  for (let i = 0; i < queries.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") {
      req.log.error({ err: r.reason, query: queries[i] }, "Research provider error");
      continue;
    }
    const [row] = await db.insert(researchResultsTable).values({
      sessionId: Number(sessionId),
      userId: user.id,
      query: queries[i],
      answer: r.value.answer,
      sources: r.value.sources as unknown as Record<string, unknown>[],
      trigger,
      status: "ok",
    }).returning();
    persisted.push(row);
  }

  if (persisted.length === 0) {
    res.status(502).json({ error: "Research provider failed. Please try again." });
    return;
  }

  // Increment usage once per successful search (best-effort).
  if (!user.isAdmin && user.plan !== "admin") {
    const usage = await getOrCreateUsage(user.id, user.plan);
    await db.update(usageTable)
      .set({ researchRequestsUsed: sql`COALESCE(research_requests_used, 0) + ${persisted.length}` })
      .where(eq(usageTable.id, usage.id))
      .catch((err: unknown) => req.log.error({ err }, "Failed to increment research usage"));
  }

  // Back-compat: return the FIRST persisted result at the top level (the
  // frontend's older code path that does `setResults((prev) => [r, ...prev])`
  // still works). Also expose the full array as `results` so the panel can
  // fan all of them in at once.
  const shape = (r: typeof researchResultsTable.$inferSelect) => ({
    id: r.id,
    sessionId: r.sessionId,
    query: r.query,
    answer: r.answer,
    sources: r.sources,
    trigger: r.trigger,
    createdAt: r.createdAt,
  });

  res.status(201).json({
    ...shape(persisted[0]),
    results: persisted.map(shape),
  });
});

export default router;
