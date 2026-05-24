import { Router, type IRouter } from "express";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import {
  db,
  transcriptsTable,
  aiAssistsTable,
  meetingNotesTable,
  sessionsTable,
  usageTable,
  researchResultsTable,
} from "@workspace/db";
import {
  RequestAiAssistParams,
  RequestAiAssistBody,
  GenerateAiSummaryParams,
} from "@workspace/api-zod";
import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { getOrCreateUsage } from "../lib/usage-helpers";
import { decideInsight, synthesizeInsight, fallbackTipFromResearch } from "../lib/insight-engine";
import { buildConversationContext, looksLikeQuestion } from "../lib/conversation-context";
import { isResearchAvailable, research } from "../lib/research-provider";
import { getPlanLimits } from "../lib/plans";

/** Retry transient LLM errors (429 rate-limit, 5xx). Same shape as the
    helper inside insight-engine.ts; kept local because ai.ts shouldn't
    reach across files for a 25-line utility. */
async function withLlmRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const transient = status === 429 || (status !== undefined && status >= 500 && status < 600);
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

const router: IRouter = Router();

// Feed enough recent context that the model can answer questions referring to
// things said minutes earlier, not just the last 2-3 sentences.
const MAX_RAW_LINES = 40;
const SUMMARIZE_THRESHOLD = 60;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function buildRollingContext(sessionId: number): Promise<string> {
  const all = await db
    .select({ speaker: transcriptsTable.speakerLabel, text: transcriptsTable.text })
    .from(transcriptsTable)
    .where(eq(transcriptsTable.sessionId, sessionId))
    .orderBy(asc(transcriptsTable.startMs));

  if (!all.length) return "(No conversation recorded yet.)";

  if (all.length <= MAX_RAW_LINES) {
    return all.map((t) => `${t.speaker}: ${t.text}`).join("\n");
  }

  const older = all.slice(0, all.length - MAX_RAW_LINES);
  const recent = all.slice(all.length - MAX_RAW_LINES);

  let olderContext: string;
  if (older.length >= SUMMARIZE_THRESHOLD) {
    const olderRaw = older.map((t) => `${t.speaker}: ${t.text}`).join("\n");
    try {
      const summary = await openai.chat.completions.create({
        model: LLM_MODEL,
        max_tokens: 800,
        messages: [
          { role: "system", content: "Summarise the following conversation excerpt in 4-7 sentences. Be factual and dense. Preserve every concrete entity: names, companies, numbers, decisions, open questions, and the chronological flow." },
          { role: "user", content: olderRaw },
        ],
      });
      olderContext = `[Earlier context summary]: ${summary.choices[0]?.message?.content?.trim() || olderRaw}`;
    } catch {
      olderContext = `[Earlier context]: ${older.slice(-5).map((t) => `${t.speaker}: ${t.text}`).join(" ")}`;
    }
  } else {
    olderContext = older.map((t) => `${t.speaker}: ${t.text}`).join("\n");
  }

  return `${olderContext}\n\n[Recent conversation]:\n${recent.map((t) => `${t.speaker}: ${t.text}`).join("\n")}`;
}

async function checkAiLimit(userId: number, plan: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const usage = await getOrCreateUsage(userId, plan);
  const { aiRequestsUsed, aiRequestsLimit } = usage;
  if (aiRequestsLimit === -1) return { allowed: true, used: aiRequestsUsed, limit: -1 };
  return { allowed: aiRequestsUsed < aiRequestsLimit, used: aiRequestsUsed, limit: aiRequestsLimit };
}

async function incrementAiUsage(userId: number, plan: string) {
  const usage = await getOrCreateUsage(userId, plan);
  await db.update(usageTable)
    .set({ aiRequestsUsed: sql`${usageTable.aiRequestsUsed} + 1` })
    .where(eq(usageTable.id, usage.id));
}

/** Returns session only if owned by user (or admin). 404-safe. */
async function getOwnedSession(sessionId: number, userId: number, isAdmin: boolean) {
  const [session] = await db.select().from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!session) return null;
  if (!isAdmin && session.userId !== userId) return null;
  return session;
}

// ── Prompt templates ─────────────────────────────────────────────────────────

const LANGUAGE_RULE = `Respond in the exact same language as the conversation. If the conversation is in German, respond in German. If in English, respond in English. Never switch languages.`;

const CONTEXT_RULE = `You receive the FULL recent transcript, not just the last sentence. When the latest question references something the speakers discussed earlier (a company, a number, a decision, a name) you MUST scan the whole excerpt and pull that thread back in. Don't reduce your answer to whatever the very last words were.`;

const COMPLETENESS_RULE = `Always deliver a COMPLETE sentence. Never end with an ellipsis or a half-finished phrase. If a thought needs two sentences, write two — concise but finished.`;

const MODE_PROMPTS: Record<string, string> = {
  objection: `You are a sharp, strategic conversation coach. Generate ONE precise and compelling line the listener could say RIGHT NOW — a counterpoint, intelligent question, reframe, or strategic observation that advances the conversation. Direct and specific, not generic. Output ONLY the suggested line, nothing else. Keep it 1-2 complete sentences, max ~50 words. ${LANGUAGE_RULE} ${CONTEXT_RULE} ${COMPLETENESS_RULE}`,
  answer: `You are a knowledgeable assistant. A question was just asked or a topic raised. Generate a clear, confident answer the listener could give. Be factual and specific — when the question refers to something said earlier in the conversation, pull that context in instead of just answering the literal last sentence. Output ONLY the response to deliver. Keep it 1-3 complete sentences, max ~70 words. ${LANGUAGE_RULE} ${CONTEXT_RULE} ${COMPLETENESS_RULE}`,
  explain: `You are an expert commentator. Provide a brief but insightful background explanation, definition, or context that deepens understanding of what's being discussed. Output ONLY the explanation. Keep it 1-3 complete sentences, max ~80 words. ${LANGUAGE_RULE} ${CONTEXT_RULE} ${COMPLETENESS_RULE}`,
  logic_check: `You are a critical thinking expert. Identify the most significant logical gap, hidden assumption, contradiction, or unsupported claim in the recent conversation. Be specific. Output ONLY the observation. Keep it 1-2 complete sentences, max ~50 words. ${LANGUAGE_RULE} ${CONTEXT_RULE} ${COMPLETENESS_RULE}`,
};

const MODE_REASONING: Record<string, string> = {
  objection: "Identified the current conversational moment and generated a precise, context-aware strategic response.",
  answer: "Synthesised the conversation context to formulate a direct, fact-grounded reply.",
  explain: "Added contextual depth by surfacing relevant background knowledge tied to the current topic.",
  logic_check: "Applied structured critical analysis to detect a logical flaw or unsupported assumption.",
};

// ── Routes ───────────────────────────────────────────────────────────────────

router.post("/sessions/:id/ai-assist", async (req, res): Promise<void> => {
  const params = RequestAiAssistParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = RequestAiAssistBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const user = req.user!;

  const session = await getOwnedSession(params.data.id, user.id, user.isAdmin);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  if (!llmConfigured) {
    res.status(503).json({ error: "ai_not_configured", message: "AI is not configured. Set LLM_API_KEY on the server." });
    return;
  }

  if (!user.isAdmin && user.plan !== "admin") {
    const limitCheck = await checkAiLimit(user.id, user.plan);
    if (!limitCheck.allowed) {
      res.status(429).json({ error: "AI request limit reached", limitExceeded: true, used: limitCheck.used, limit: limitCheck.limit });
      return;
    }
  }

  const { mode, context: inlineContext } = parsed.data;
  const systemPrompt = MODE_PROMPTS[mode] ?? MODE_PROMPTS.objection;
  const context = inlineContext?.trim() ? inlineContext : await buildRollingContext(params.data.id);

  let suggestion: string;
  try {
    const completion = await withLlmRetry("ai-assist", () =>
      openai.chat.completions.create({
        model: LLM_MODEL,
        max_tokens: 1024,
        temperature: 0.5,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here is the conversation so far:\n\n${context}\n\nGenerate your response now.` },
        ],
      }),
    );
    suggestion = completion.choices[0]?.message?.content?.trim() || "";
    if (!suggestion) throw new Error("Empty completion from LLM");
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;
    const detail = err?.error?.message ?? err?.message ?? "Unknown LLM error";
    req.log.error({ err, status, model: LLM_MODEL }, "AI assist LLM request failed");

    // Friendlier message for the most common case (rate-limit) so the user
    // sees "try again in a moment" instead of a raw 429 stack trace.
    const friendlyMessage =
      status === 429
        ? "AI is rate-limited right now. Wait a few seconds and try again."
        : `LLM request failed (model ${LLM_MODEL}${status ? `, status ${status}` : ""}): ${detail}`;
    res.status(status === 429 ? 429 : 502).json({
      error: status === 429 ? "ai_rate_limited" : "ai_provider_error",
      message: friendlyMessage,
    });
    return;
  }

  if (!user.isAdmin && user.plan !== "admin") {
    await incrementAiUsage(user.id, user.plan).catch((err) =>
      req.log.error({ err }, "Failed to increment AI usage")
    );
  }

  const [assist] = await db.insert(aiAssistsTable).values({
    sessionId: params.data.id,
    mode,
    suggestion,
    reasoning: MODE_REASONING[mode] ?? MODE_REASONING.objection,
  }).returning();

  res.json(assist);
});

router.post("/sessions/:id/ai-summary", async (req, res): Promise<void> => {
  const params = GenerateAiSummaryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const session = await getOwnedSession(params.data.id, req.user!.id, req.user!.isAdmin);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const transcripts = await db
    .select()
    .from(transcriptsTable)
    .where(eq(transcriptsTable.sessionId, params.data.id))
    .orderBy(asc(transcriptsTable.startMs));

  if (!transcripts.length) {
    res.json({
      summary: "No transcript content available yet. Start speaking to generate meeting notes.",
      actionItems: [], decisions: [], openQuestions: [], keyInsights: [],
    });
    return;
  }

  if (!llmConfigured) {
    res.status(503).json({ error: "ai_not_configured", message: "AI is not configured. Set LLM_API_KEY on the server." });
    return;
  }

  const fullTranscript = transcripts.map((t) => `${t.speakerLabel}: ${t.text}`).join("\n");

  let notes: { summary: string; actionItems: string[]; decisions: string[]; openQuestions: string[]; keyInsights: string[] };

  try {
    const completion = await withLlmRetry("ai-summary", () => openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert meeting assistant. Analyse the transcript and respond with a JSON object (no markdown, no code fences) with exactly these keys:
- summary: string (2-4 sentences, executive summary)
- actionItems: string[] (each is a concrete next step with owner if mentioned, max 5)
- decisions: string[] (each is a decision that was made, max 4)
- openQuestions: string[] (each is an unanswered question, max 4)
- keyInsights: string[] (each is a key observation or takeaway, max 4)

Respond in the same language as the transcript. Be specific to the content. No generic placeholders.`,
        },
        { role: "user", content: `Meeting transcript:\n\n${fullTranscript}` },
      ],
    }));
    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    notes = {
      summary: parsed.summary ?? "",
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
      keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
    };
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;
    const detail = err?.error?.message ?? err?.message ?? "Unknown LLM error";
    req.log.error({ err, status, model: LLM_MODEL }, "AI summary LLM request failed");
    res.status(502).json({
      error: "ai_provider_error",
      message: `LLM summary failed (model ${LLM_MODEL}${status ? `, status ${status}` : ""}): ${detail}`,
    });
    return;
  }

  const existing = await db.select().from(meetingNotesTable).where(eq(meetingNotesTable.sessionId, params.data.id));
  if (existing.length > 0) {
    await db.update(meetingNotesTable).set(notes).where(eq(meetingNotesTable.sessionId, params.data.id));
  } else {
    await db.insert(meetingNotesTable).values({ sessionId: params.data.id, ...notes });
  }

  res.json(notes);
});

// ── Insight mode routes ───────────────────────────────────────────────────────

router.get("/ai/insights", async (req, res): Promise<void> => {
  const sessionId = Number(req.query.sessionId);
  if (isNaN(sessionId)) { res.status(400).json({ error: "sessionId query param required" }); return; }

  const session = await getOwnedSession(sessionId, req.user!.id, req.user!.isAdmin);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const rows = await db
    .select()
    .from(aiAssistsTable)
    .where(and(eq(aiAssistsTable.sessionId, sessionId), eq(aiAssistsTable.mode, "insight")))
    .orderBy(desc(aiAssistsTable.createdAt));

  res.json(rows.map((r) => ({
    id: r.id, sessionId: r.sessionId, category: r.category,
    suggestion: r.suggestion, status: r.status, createdAt: r.createdAt,
  })));
});

router.post("/ai/insights/generate", async (req, res): Promise<void> => {
  const { sessionId } = req.body ?? {};
  if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }

  const session = await getOwnedSession(Number(sessionId), req.user!.id, req.user!.isAdmin);
  if (!session || session.status !== "active") { res.status(204).end(); return; }

  // Full chronological transcript so the engine sees the whole arc, not just
  // the last sentence. The rolling summary cache keeps the LLM payload small
  // for long meetings.
  const allRows = await db
    .select({ text: transcriptsTable.text, startMs: transcriptsTable.startMs })
    .from(transcriptsTable)
    .where(eq(transcriptsTable.sessionId, Number(sessionId)))
    .orderBy(asc(transcriptsTable.startMs));
  const fullText = allRows.map((r) => r.text).join(" ");

  const sessionStartedAtMs = session.createdAt
    ? new Date(session.createdAt).getTime()
    : (allRows[0]?.startMs ?? Date.now());
  const ctx = await buildConversationContext({
    sessionId: Number(sessionId),
    sessionStartedAtMs,
    fullText,
    recentChars: 2500,
  });

  // Recent insights for repeat-suppression.
  const recentInsights = await db
    .select({ suggestion: aiAssistsTable.suggestion })
    .from(aiAssistsTable)
    .where(and(eq(aiAssistsTable.sessionId, Number(sessionId)), eq(aiAssistsTable.mode, "insight")))
    .orderBy(desc(aiAssistsTable.createdAt))
    .limit(6);
  const previousInsightTips = recentInsights.map((r) => r.suggestion).filter(Boolean);

  // Two-pass agentic flow: decide -> (optional research) -> synthesize.
  const decision = await decideInsight({
    ageMinutes: ctx.ageMinutes,
    olderSummary: ctx.olderSummary,
    recentText: ctx.recentText,
    previousInsights: previousInsightTips,
    reactive: looksLikeQuestion(ctx.recentText.slice(-600)),
  });
  if (!decision || !decision.shouldFire) { res.status(204).end(); return; }

  let finalTip = decision.tip ?? "";
  let finalCategory = decision.category;
  const user = req.user!;

  if (decision.needsResearch && decision.researchQuery && isResearchAvailable()) {
    const limits = getPlanLimits(user.plan);
    if (user.isAdmin || limits.researchRequests > 0) {
      try {
        const result = await research(decision.researchQuery);
        await db.insert(researchResultsTable).values({
          sessionId: Number(sessionId),
          userId: user.id,
          query: decision.researchQuery,
          answer: result.answer,
          sources: result.sources as unknown as Record<string, unknown>[],
          trigger: "auto",
          status: "ok",
        });
        const synth = await synthesizeInsight(ctx.recentText, result.answer, result.sources);
        if (synth) {
          finalTip = synth.tip;
          finalCategory = synth.category;
        } else {
          // Synth failed (often Gemini rate-limit). Use the Tavily answer
          // directly so the user still sees the looked-up facts.
          const fallback = fallbackTipFromResearch(result.answer, result.sources, "de");
          if (fallback) {
            finalTip = fallback.tip;
            finalCategory = fallback.category;
          }
        }
      } catch (err) {
        req.log.error({ err }, "Insight auto-research failed");
      }
    }
  }

  if (!finalTip) { res.status(204).end(); return; }

  const [row] = await db.insert(aiAssistsTable).values({
    sessionId: Number(sessionId),
    mode: "insight",
    suggestion: finalTip,
    category: finalCategory,
    status: "new",
  }).returning();

  res.json({
    id: row.id, sessionId: row.sessionId, category: row.category,
    suggestion: row.suggestion, status: row.status, createdAt: row.createdAt,
  });
});

router.patch("/ai/insights/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!status || !["used", "dismissed"].includes(status)) {
    res.status(400).json({ error: "status must be 'used' or 'dismissed'" });
    return;
  }

  const [insight] = await db.select().from(aiAssistsTable).where(eq(aiAssistsTable.id, id)).limit(1);
  if (!insight) { res.status(404).json({ error: "Insight not found" }); return; }

  const session = await getOwnedSession(insight.sessionId, req.user!.id, req.user!.isAdmin);
  if (!session) { res.status(404).json({ error: "Insight not found" }); return; }

  const [row] = await db.update(aiAssistsTable).set({ status }).where(eq(aiAssistsTable.id, id)).returning();
  res.json({
    id: row.id, sessionId: row.sessionId, category: row.category,
    suggestion: row.suggestion, status: row.status, createdAt: row.createdAt,
  });
});

export default router;
