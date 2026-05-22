import { Router, type IRouter } from "express";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import {
  db,
  transcriptsTable,
  aiAssistsTable,
  meetingNotesTable,
  sessionsTable,
  usageTable,
} from "@workspace/db";
import {
  RequestAiAssistParams,
  RequestAiAssistBody,
  GenerateAiSummaryParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getOrCreateUsage } from "../lib/usage-helpers";

const router: IRouter = Router();

const MAX_RAW_LINES = 12;
const SUMMARIZE_THRESHOLD = 20;

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
        model: "gpt-5.4",
        max_completion_tokens: 300,
        messages: [
          { role: "system", content: "Summarise the following conversation excerpt in 2-4 sentences. Be factual and concise. Preserve key decisions, facts, and names." },
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

const MODE_PROMPTS: Record<string, string> = {
  objection: `You are a sharp, strategic conversation coach. Based on the conversation context, generate ONE precise and compelling response the listener could say RIGHT NOW. It should be a counterpoint, intelligent question, reframe, or strategic observation that advances the conversation. Be direct and specific — not generic. Output ONLY the suggested line to say, nothing else. Keep it under 40 words. ${LANGUAGE_RULE}`,
  answer: `You are a knowledgeable assistant. A question was just asked or a topic raised in the conversation. Generate a clear, confident, and concise answer that the listener could give. Be factual and specific. Output ONLY the response to deliver, nothing else. Keep it under 50 words. ${LANGUAGE_RULE}`,
  explain: `You are an expert commentator. Based on the conversation, provide a brief but insightful background explanation, definition, or context that would deepen understanding. Output ONLY the explanation text, nothing else. Keep it under 60 words. ${LANGUAGE_RULE}`,
  logic_check: `You are a critical thinking expert. Analyse the conversation and identify the most significant logical gap, hidden assumption, contradiction, or unsupported claim. Be specific. Output ONLY a one-sentence observation starting with a description of the issue. Keep it under 40 words. ${LANGUAGE_RULE}`,
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
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Here is the conversation so far:\n\n${context}\n\nGenerate your response now.` },
      ],
    });
    suggestion = completion.choices[0]?.message?.content?.trim() || "Unable to generate a response at this time.";
  } catch (err) {
    req.log.error({ err }, "OpenAI request failed");
    suggestion = "AI is temporarily unavailable. Please try again in a moment.";
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

  const fullTranscript = transcripts.map((t) => `${t.speakerLabel}: ${t.text}`).join("\n");

  let notes: { summary: string; actionItems: string[]; decisions: string[]; openQuestions: string[]; keyInsights: string[] };

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 800,
      messages: [
        {
          role: "system",
          content: `You are an expert meeting assistant. Analyse the transcript and respond with a JSON object (no markdown, no code fences) with exactly these keys:
- summary: string (2-4 sentences, executive summary)
- actionItems: string[] (each is a concrete next step with owner if mentioned, max 5)
- decisions: string[] (each is a decision that was made, max 4)
- openQuestions: string[] (each is an unanswered question, max 4)
- keyInsights: string[] (each is a key observation or takeaway, max 4)

Be specific to the content. No generic placeholders.`,
        },
        { role: "user", content: `Meeting transcript:\n\n${fullTranscript}` },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const parsed = JSON.parse(raw);
    notes = {
      summary: parsed.summary ?? "",
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
      keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
    };
  } catch (err) {
    req.log.error({ err }, "OpenAI summary failed");
    notes = { summary: "Summary generation failed. Please try again.", actionItems: [], decisions: [], openQuestions: [], keyInsights: [] };
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

  const { pickScoredInsight } = await import("../lib/insight-pool");

  const recentRows = await db
    .select({ text: transcriptsTable.text })
    .from(transcriptsTable)
    .where(eq(transcriptsTable.sessionId, Number(sessionId)))
    .orderBy(desc(transcriptsTable.startMs))
    .limit(20);

  const recentText = recentRows.map((r) => r.text).reverse().join(" ").slice(-600);
  const insight = pickScoredInsight(recentText, new Set());
  if (!insight) { res.status(204).end(); return; }

  const [row] = await db.insert(aiAssistsTable).values({
    sessionId: Number(sessionId),
    mode: "insight",
    suggestion: insight.text,
    category: insight.category,
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
