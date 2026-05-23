import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

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

const DECIDE_PROMPT = `You are an experienced strategic advisor sitting next to a listener in a LIVE business conversation. Your job is to whisper insights ONLY when they add real value — like a sharp colleague who only speaks up when it matters. You have a research tool available; when concrete facts (numbers, names, companies, regulations) would help, you flag them for lookup instead of bluffing.

Decide whether to speak up RIGHT NOW based on the most recent transcript.

WHEN TO SPEAK UP:
- A specific opportunity is being missed (e.g. they mentioned a budget — suggest a related angle).
- A risk or weakness is visible (an unsupported claim, contradiction, vague commitment).
- A useful callback to something said earlier in this same conversation.
- A sharp, specific question worth asking right now.
- A factual gap where data would clearly help. In that case set needsResearch=true and DON'T write the tip yourself — research will be fetched and the tip composed in a second step.

WHEN TO STAY SILENT (return shouldFire=false):
- Just pleasantries or basic context.
- Nothing concrete or actionable has been said.
- Your tip would be generic ("consider their needs", "build rapport").
- You're not sure it adds value.

Output ONLY this JSON object (no markdown, no code fences):
{
  "shouldFire": boolean,
  "needsResearch": boolean,
  "researchQuery": string | null,   // concise web query (max 12 words) when needsResearch
  "tip": string | null,             // ONLY when needsResearch=false; otherwise null
  "category": "opportunity" | "risk" | "connection" | "question"
}

Rules:
- Tip (when given directly) must be at most 30 words, specific, concrete, actionable, ENDING with a complete sentence.
- Match the transcript's language exactly (German transcript → German tip).
- Never invent facts. If you'd be guessing on data, set needsResearch=true with a targeted query.
- Be eager about research: any specific company name, market figure, regulation, person, product, or technical term that the listener probably can't recall should trigger needsResearch=true. Looking it up is cheap.`;

export async function decideInsight(recentText: string): Promise<InsightDecision | null> {
  if (!llmConfigured) return null;
  const text = recentText.trim();
  if (text.length < 40) return null;

  let raw: string;
  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 800,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DECIDE_PROMPT },
        { role: "user", content: `Recent transcript:\n\n${text}\n\nDecide now.` },
      ],
    });
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

const SYNTH_PROMPT = `You are the same strategic advisor from before. You just looked up data for a fact question that came up in the LIVE conversation, and you now whisper a SHORT, SUBSTANTIVE tip that USES the research findings.

You receive:
1. The recent transcript.
2. The research answer + a list of source titles & domains.

Write a single concrete tip (max ~40 words, complete sentences, advisor tone) in the SAME language as the transcript. EMBED the key fact (number, name, date, etc.) from the research directly. Cite the most relevant source domain in parentheses at the end like: "(Quelle: example.com)" or "(Source: example.com)". Do NOT say things like "check the numbers" — give the numbers.

If the research came back empty or off-topic, write a tip that admits the uncertainty in one short sentence and suggests asking the speaker directly.

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
    const completion = await openai.chat.completions.create({
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
    });
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

export async function generateInsight(recentText: string): Promise<GeneratedInsight | null> {
  const d = await decideInsight(recentText);
  if (!d || !d.shouldFire) return null;
  // For the legacy callers we don't run pass 2; just return the direct tip
  // when there is one, or a stub note that research is needed.
  const tip = d.tip ?? (d.researchQuery ? `(needs lookup) ${d.researchQuery}` : "");
  if (!tip) return null;
  return { tip, category: d.category, needsResearch: d.needsResearch, researchQuery: d.researchQuery };
}
