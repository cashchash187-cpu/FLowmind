import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

/**
 * Retry a function on transient LLM errors (429 rate-limit, 5xx overload).
 * Gemini's free tier in particular returns lots of 503s under modest load —
 * one retry with a short backoff is usually enough to get through.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const isTransient = status === 429 || (status !== undefined && status >= 500 && status < 600);
      if (!isTransient || i === attempts - 1) throw err;
      const delayMs = 600 * Math.pow(2, i); // 600ms, 1.2s, 2.4s
      logger.warn({ label, status, attempt: i + 1, delayMs }, "[LLM] transient error, retrying");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

export type InsightCategory = "opportunity" | "risk" | "connection" | "question";

/** Outcome of the first pass: decide if we should speak and whether we need facts. */
export interface InsightDecision {
  /** If false: stay silent this tick. */
  shouldFire: boolean;
  /** If true, caller should call the research API with researchQuery and then synthesizeInsight(). */
  needsResearch: boolean;
  researchQuery: string | null;
  /** Ready-to-show tip when no research is needed. */
  tip: string | null;
  category: InsightCategory;
}

/** Outcome of the second pass when research was requested + completed. */
export interface InsightSynthesis {
  tip: string;
  category: InsightCategory;
}

export interface ResearchSourceLite {
  title: string;
  url: string;
  snippet: string;
}

const VALID_CATEGORIES: InsightCategory[] = ["opportunity", "risk", "connection", "question"];

// ─── Pass 1: decide ─────────────────────────────────────────────────────────

const DECIDE_PROMPT = `You are an experienced strategic advisor who has been QUIETLY SITTING IN this live business meeting from the start. You hear everything. You speak up only when you genuinely add value — like a sharp colleague who knows when to whisper and when to stay silent.

You will receive:
1. How long the meeting has been going (in minutes).
2. A bullet-point summary of EVERYTHING said earlier in this meeting (themes, decisions, open questions, recurring concerns). Treat this as ground truth — you DO remember it.
3. The most recent verbatim transcript fragment.
4. The list of insights you have ALREADY given in this conversation (one-line summaries — never repeat them).
5. A flag whether the latest fragment contains a DIRECT QUESTION you should react to.

Decide whether to speak up RIGHT NOW.

THREE distinct trigger cases:

A) REACTIVE — Someone just asked a direct question. ALWAYS speak up unless the same question was answered by you very recently in "Already said". If the question wants concrete data → needsResearch=true. If it wants opinion / advice → write the tip directly. Be fast and on-point.

B) STRATEGIC — Reading across the whole meeting (older summary + recent), you spot something the listener should know NOW: a pattern (e.g. "they've raised price concerns 3 times — push ROI angle"), a missed opportunity, a contradiction with something said 15 minutes ago, an unstated assumption that risks the deal. These insights LEVERAGE the older context — they're things only someone who heard the whole meeting could spot.

C) FACT GAP — A specific company / regulation / number / person was just mentioned that the listener probably can't recall on the fly. Set needsResearch=true with a targeted researchQuery.

WHEN TO STAY SILENT (shouldFire=false):
- Pleasantries, basic introductions, idle chatter.
- A point you have ALREADY made (check "Already said" carefully — even a paraphrase counts as a repeat).
- Generic coaching ("listen actively", "build rapport") — that's noise.
- You're not confident you'd add value.

Output ONLY this JSON (no markdown, no code fences):
{
  "shouldFire": boolean,
  "needsResearch": boolean,
  "researchQuery": string | null,   // targeted web query (max 12 words) when needsResearch
  "tip": string | null,             // REQUIRED when needsResearch=false AND shouldFire=true
  "category": "opportunity" | "risk" | "connection" | "question"
}

Hard rules:
- Tip is 1-3 complete sentences, max ~60 words, specific and concrete, in the conversation's exact language (German → German, English → English, etc.).
- When a tip leverages older context, briefly anchor it ("Earlier they mentioned X — now would be the moment to …").
- Never invent factual data; lookup instead.
- NEVER repeat a point that's already in "Already said". When a topic comes up again, advance the angle or stay silent.`;

export interface DecideContext {
  /** Minutes since the meeting began. */
  ageMinutes: number;
  /** Cached summary of speech before `recentText`. Null when the meeting is
      still short enough that recent IS everything. */
  olderSummary: string | null;
  /** Last ~2500 chars of speech, chronological. */
  recentText: string;
  /** Previous insights given this session (one-line each). */
  previousInsights: string[];
  /** Did the just-spoken text contain a direct question? */
  reactive: boolean;
}

export async function decideInsight(
  ctxOrText: DecideContext | string,
  // Back-compat: old callers passed (recentText, previousInsights).
  legacyPrevious: string[] = [],
): Promise<InsightDecision | null> {
  if (!llmConfigured) return null;

  const ctx: DecideContext = typeof ctxOrText === "string"
    ? {
        ageMinutes: 0,
        olderSummary: null,
        recentText: ctxOrText,
        previousInsights: legacyPrevious,
        reactive: false,
      }
    : ctxOrText;

  const text = ctx.recentText.trim();
  if (text.length < 40 && !ctx.reactive) return null;

  // Last few insights as one bullet per line — keeps the context small but
  // gives the LLM enough to recognise its own past output and not repeat it.
  const alreadySaid = ctx.previousInsights
    .slice(0, 6)
    .map((t, i) => `${i + 1}. ${t.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");

  const ageLine = ctx.ageMinutes >= 1
    ? `Meeting age: ${ctx.ageMinutes.toFixed(1)} minutes.`
    : `Meeting age: just started.`;

  const userMsg =
    `${ageLine}\n\n` +
    (ctx.olderSummary
      ? `Earlier in this meeting (summary):\n${ctx.olderSummary}\n\n`
      : "") +
    `Recent transcript (verbatim, most recent first below):\n${text}\n\n` +
    `Already said (never repeat — even paraphrased):\n${alreadySaid || "(nothing yet)"}\n\n` +
    `Direct question in recent text: ${ctx.reactive ? "YES — react fast." : "no"}\n\n` +
    `Decide now.`;

  let raw: string;
  try {
    const completion = await withRetry("decide", () =>
      openai.chat.completions.create({
        model: LLM_MODEL,
        max_tokens: 800,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: DECIDE_PROMPT },
          { role: "user", content: userMsg },
        ],
      }),
    );
    raw = completion.choices[0]?.message?.content?.trim() || "";
  } catch (err) {
    logger.error({ err }, "[INSIGHT-ENGINE] decide LLM call failed");
    return null;
  }

  if (!raw) return null;

  let parsed: Partial<InsightDecision>;
  try {
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    logger.warn({ raw: raw.slice(0, 200) }, "[INSIGHT-ENGINE] non-JSON decide output");
    return null;
  }

  const shouldFire = parsed.shouldFire === true;
  if (!shouldFire) return { shouldFire: false, needsResearch: false, researchQuery: null, tip: null, category: "question" };

  const category: InsightCategory = VALID_CATEGORIES.includes(parsed.category as InsightCategory)
    ? (parsed.category as InsightCategory)
    : "question";

  const needsResearch = parsed.needsResearch === true;
  const researchQuery =
    needsResearch && typeof parsed.researchQuery === "string" && parsed.researchQuery.trim()
      ? parsed.researchQuery.trim().slice(0, 200)
      : null;

  // If research is needed, the tip will come from pass 2 — drop whatever the
  // model wrote here so we don't accidentally show a "check the numbers" stub.
  const tip =
    !needsResearch && typeof parsed.tip === "string" && parsed.tip.trim()
      ? parsed.tip.trim()
      : null;

  return {
    shouldFire: needsResearch ? !!researchQuery : !!tip,
    needsResearch: needsResearch && !!researchQuery,
    researchQuery: needsResearch ? researchQuery : null,
    tip,
    category,
  };
}

// ─── Pass 2: synthesize using research ──────────────────────────────────────

const SYNTH_PROMPT = `You are the same strategic advisor. You just looked up data for a fact question from the LIVE conversation. Now whisper a SHORT, SUBSTANTIVE tip that USES the research findings.

You receive:
1. The recent transcript (this is the SOURCE OF TRUTH for what language to use).
2. The research answer + a list of source titles & domains (often in a different language than the conversation — TRANSLATE the relevant numbers/facts into the transcript's language; never copy English sentences into a German conversation).

Write ONE concrete tip (max ~45 words, complete sentences, advisor tone) — and write it 100% in the SAME LANGUAGE as the transcript. EMBED the key fact (number, name, date, etc.) directly. End with the most relevant source domain in parentheses, using the transcript-language label: "(Quelle: example.com)" for German, "(Source: example.com)" for English, "(Source : example.com)" for French, etc. Do NOT say things like "check the numbers" — give them.

If the research came back empty or off-topic, write one short tip in the transcript's language that admits the uncertainty and suggests asking the speaker directly.

Output ONLY this JSON, no markdown:
{
  "tip": string,
  "category": "opportunity" | "risk" | "connection" | "question"
}`;

export function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

/**
 * Cheap, LLM-free fallback used when synthesizeInsight() fails (e.g. when
 * Gemini's free tier hits its 10 RPM cap). Returns a one-liner that quotes
 * the Tavily answer directly + the first source domain. Better than 204.
 */
export function fallbackTipFromResearch(
  researchAnswer: string,
  researchSources: ResearchSourceLite[],
  language: "de" | "en" = "de",
): InsightSynthesis | null {
  const answer = researchAnswer?.trim();
  if (!answer) return null;
  const firstDomain = researchSources[0]?.url ? domainOf(researchSources[0].url) : "";
  // Trim to ~280 chars so it stays "whisper-sized".
  const compact = answer.length > 280 ? answer.slice(0, 277).trimEnd() + "…" : answer;
  const source = firstDomain ? (language === "de" ? ` (Quelle: ${firstDomain})` : ` (Source: ${firstDomain})`) : "";
  return { tip: `${compact}${source}`, category: "question" };
}

export async function synthesizeInsight(
  recentText: string,
  researchAnswer: string,
  researchSources: ResearchSourceLite[],
): Promise<InsightSynthesis | null> {
  if (!llmConfigured) return null;

  const sourcesBlock = researchSources
    .slice(0, 5)
    .map((s, i) => `${i + 1}. ${s.title} — ${domainOf(s.url)} :: ${s.snippet.slice(0, 200)}`)
    .join("\n");

  let raw: string;
  try {
    const completion = await withRetry("synth", () =>
      openai.chat.completions.create({
        model: LLM_MODEL,
        max_tokens: 1024,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYNTH_PROMPT },
          {
            role: "user",
            content:
              `Recent transcript:\n${recentText}\n\n` +
              `Research answer:\n${researchAnswer || "(no direct answer)"}\n\n` +
              `Sources:\n${sourcesBlock || "(no sources)"}`,
          },
        ],
      }),
    );
    raw = completion.choices[0]?.message?.content?.trim() || "";
  } catch (err) {
    logger.error({ err }, "[INSIGHT-ENGINE] synth LLM call failed");
    return null;
  }

  if (!raw) return null;

  let parsed: Partial<InsightSynthesis>;
  try {
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    logger.warn({ raw: raw.slice(0, 200) }, "[INSIGHT-ENGINE] non-JSON synth output");
    return null;
  }

  const tip = typeof parsed.tip === "string" ? parsed.tip.trim() : "";
  if (!tip) return null;
  const category: InsightCategory = VALID_CATEGORIES.includes(parsed.category as InsightCategory)
    ? (parsed.category as InsightCategory)
    : "question";
  return { tip, category };
}

// ─── Back-compat shim ───────────────────────────────────────────────────────
// Older routes called generateInsight() expecting the legacy single-pass
// shape. Keep that working by delegating to decideInsight().
export interface GeneratedInsight {
  tip: string;
  category: InsightCategory;
  needsResearch: boolean;
  researchQuery: string | null;
}

export async function generateInsight(
  recentText: string,
  previousInsights: string[] = [],
): Promise<GeneratedInsight | null> {
  const d = await decideInsight(recentText, previousInsights);
  if (!d || !d.shouldFire) return null;
  // For the legacy callers we don't run pass 2; just return the direct tip
  // when there is one, or a stub note that research is needed.
  const tip = d.tip ?? (d.researchQuery ? `(needs lookup) ${d.researchQuery}` : "");
  if (!tip) return null;
  return { tip, category: d.category, needsResearch: d.needsResearch, researchQuery: d.researchQuery };
}
