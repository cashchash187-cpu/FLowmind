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

const DECIDE_PROMPT = `You are an experienced strategic advisor sitting in this live business meeting. You speak only when you have a SPECIFIC, ACTIONABLE thing to say. Vague coaching is worse than silence.

You will receive:
1. Meeting age (minutes).
2. A bullet-point summary of everything said earlier in this meeting.
3. The most recent verbatim transcript fragment.
4. "Already said" — the insights you've ALREADY given. Treat these as banned.
5. Whether the latest fragment contains a DIRECT QUESTION.

FOUR trigger cases:

A) REACTIVE — A direct question was just asked.
   • Your tip MUST be the actual answer or a concrete recommendation. Not "we should think about X". Not "this is a good question". Not "let's consider Y".
   • If the question is "What should X do?" → list 2-3 SPECIFIC moves (e.g. "Bundling Software-Leasing mit Beratungspaketen", "Fokussierung auf Mittelstand-EV-Flotten", "Strategische Allianz mit Fintech-Plattformen").
   • If the question is "What would you suggest?" → make a specific recommendation with a 1-sentence rationale.
   • If you genuinely don't have a sharp answer → set shouldFire=false. Saying nothing is better than punting.

B) STRATEGIC — A pattern across the meeting (from the older summary + recent) that someone who heard everything would catch:
   • A missed opportunity ("They mentioned a 50M budget — push the enterprise plan").
   • A contradiction with something said earlier.
   • A pattern of objections that suggests a deeper concern.
   • Must reference WHAT in the earlier context you're connecting to.

C) FACT GAP — A specific company / number / regulation / person came up. Set needsResearch=true with a targeted researchQuery. The synthesizer will write the tip after the lookup.

D) FOLLOW-UP — The user asked a COMPOUND question with two or more parts (e.g. "Wie sind die Zahlen UND was muss X anders machen?", "What's the budget AND who decides?") and "Already said" only covers ONE part. Fire a tip for the UNANSWERED part. Reference what was already covered briefly ("Anschließend an die genannten Zahlen, hier mein Vorschlag: …" / "Building on the numbers above, my recommendation: …"). This is critical — a smart advisor doesn't drop half the question. Look hard at the recent transcript for unanswered sub-questions.

═══ FORBIDDEN PATTERNS (return shouldFire=false instead) ═══
✗ Restating or rephrasing the question.
✗ "Wir sollten überlegen / nachdenken über…" / "Es wäre gut zu prüfen…".
✗ "Konkrete Vorschläge wären hier hilfreich" — YOU give the concrete suggestions, don't ask for them.
✗ Meta-commentary ("Das ist ein wichtiger Punkt", "Eine spannende Frage").
✗ "Differenzierung stärken" / "Wettbewerbsfähigkeit verbessern" — that's a category, not an idea.
✗ ANY paraphrase of an entry in "Already said".

═══ TOPIC SATURATION ═══
Counting the "Already said" list: if 2 or more entries already address the
SAME topic / question / theme that the speakers are still on, you've said
enough. shouldFire=false. The user can ask a follow-up to unlock you. A
real advisor doesn't keep volunteering more angles on a settled topic.

═══ FEW-SHOT EXAMPLES ═══

Example 1
Recent: "Was könnten die Deutsche Leasing aktiv ändern, um wettbewerbsfähig zu bleiben?"
BAD tip: "Wir sollten überlegen, wie wir uns differenzieren können."
GOOD tip: "Drei konkrete Hebel: 1) End-to-End-Digitalisierung der Antragsstrecke (Online-Abschluss in <10 Min), 2) Subscription-Modelle statt klassischem Leasing für Software/IT, 3) ESG-Leasing für Elektroflotten als Premium-Segment positionieren."

Example 2
Recent: "Und was wäre dein Vorschlag?"
Earlier summary mentions: "DL-Neugeschäft 2024 bei 10,3 Mrd. €, Konkurrenz mit Deutsche Bank-Strategie."
BAD tip: "Konkrete Vorschläge zur Neupositionierung wären jetzt hilfreich."
GOOD tip: "Mein Vorschlag: Mittelstand als Kernsegment doppelt absichern — ein dediziertes EV-Leasing-Programm plus eine Software-Leasing-Sparte (z.B. SaaS-Lizenzen on demand). Das spielt eure Größe gegen die Deutsche-Bank-Strategie aus."

Example 3
Recent: "Welche Zahlen hat die Deutsche Leasing 2024 geliefert?"
GOOD: shouldFire=true, needsResearch=true, researchQuery="Deutsche Leasing 2024 Geschäftszahlen Neugeschäft", tip=null.

Example 4
"Already said" contains: "Bundling von Hardware + Software-Leasing als Differenzierung."
Recent: "Also was sollten die machen?"
GOOD: shouldFire=false (you already covered the bundling angle; advance the angle or stay silent).

Example 5 — FOLLOW-UP
Recent: "Wie sehen die Zahlen der Deutschen Leasing aus, und an was muss die DL arbeiten, um der Konkurrenz nahezukommen?"
"Already said" contains: "Die Deutsche Leasing verzeichnete 2024 ein Wachstum von 2,6% im Maschinen- und Fahrzeugleasing, während der Gesamtmarkt um 4,5% zulegte."
GOOD tip: "Anschließend an die genannten Zahlen — drei Hebel für die DL: 1) Vertriebs-Effizienz hochziehen (CRM-getriebenes Account-Management statt Filial-Vertrieb), 2) digitale End-to-End-Antragsstrecke unter 10 Min, 3) Fokus auf wachstumsstarke EV-Flotten als neues Premium-Segment."
shouldFire=true, needsResearch=false, category="opportunity"

═══ OUTPUT ═══
Output ONLY this JSON (no markdown, no code fences):
{
  "shouldFire": boolean,
  "needsResearch": boolean,
  "researchQuery": string | null,
  "tip": string | null,
  "category": "opportunity" | "risk" | "connection" | "question"
}

Hard rules:
- Match the conversation's exact language (German → German, English → English).
- Tip is 1-3 complete sentences, max ~70 words.
- Never invent factual data; if you need numbers, set needsResearch=true.
- If your tip would paraphrase an "Already said" entry: shouldFire=false. Saying nothing > repeating yourself.`;

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
        // Higher token budget — the prompt has few-shot examples that eat
        // input budget; we want room for a confident 60-70 word answer plus
        // Gemini's reasoning tokens.
        max_tokens: 1200,
        // Higher temperature pushes the model to take a stance instead of
        // hedging with "we should consider…". The post-filter catches
        // hallucinations, so we can afford the boldness.
        temperature: 0.55,
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

  // Server-side dedup safety net. Even with a strong "don't repeat" prompt
  // the LLM still slips through paraphrases — real users reported 14
  // insights all saying "E-Mobilität + Full-Service-Leasing für KMUs" in
  // slightly different words. 0.35 is aggressive but catches that case;
  // false negatives are fine, the next tick will produce something fresh.
  if (tip && ctx.previousInsights.length) {
    const similar = ctx.previousInsights.some((prev) => {
      const sim = jaccardSimilarity(tip, prev);
      return sim >= 0.35;
    });
    if (similar) {
      logger.info({ tip: tip.slice(0, 80) }, "[INSIGHT-ENGINE] dropped near-duplicate tip");
      return { shouldFire: false, needsResearch: false, researchQuery: null, tip: null, category: "question" };
    }
  }

  // Filter out tip patterns that mansplain the question instead of answering.
  if (tip && tipIsMetaCommentary(tip)) {
    logger.info({}, "[INSIGHT-ENGINE] dropped meta-commentary tip");
    return { shouldFire: false, needsResearch: false, researchQuery: null, tip: null, category: "question" };
  }

  return {
    shouldFire: needsResearch ? !!researchQuery : !!tip,
    needsResearch: needsResearch && !!researchQuery,
    researchQuery: needsResearch ? researchQuery : null,
    tip,
    category,
  };
}

// ─── Quality filters ────────────────────────────────────────────────────────

/** Jaccard similarity on lowercased word sets. Tokens shorter than 3 chars
 *  are discarded to ignore noise like "der/die/das/zu". */
function jaccardSimilarity(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3),
    );
  const A = tok(a);
  const B = tok(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Catch the most common "mansplain the question" patterns. The LLM gets one
 *  more chance on the next tick to produce something actionable. */
function tipIsMetaCommentary(tip: string): boolean {
  const t = tip.toLowerCase();
  const patterns = [
    /wir sollten (?:überlegen|nachdenken|prüfen|diskutieren)/i,
    /es wäre (?:gut|sinnvoll|wichtig)/i,
    /wäre(?:n)? (?:hier|jetzt)? hilfreich/i,
    /das ist ein wichtiger punkt/i,
    /eine (?:gute|spannende|interessante) frage/i,
    /(?:könnten|sollten) wir uns? gedanken machen/i,
    /lass uns überlegen/i,
    /we should (?:think about|consider|reflect)/i,
    /that('s| is) a (?:good|great|interesting) (?:question|point)/i,
    /would be (?:helpful|useful) to/i,
  ];
  return patterns.some((p) => p.test(t));
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
