import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

/**
 * Long meetings can run for an hour. The insight engine needs to act like a
 * real advisor who heard ALL of it, but we can't shove an hour of transcript
 * into every LLM call (token cost + slowness). So we keep a per-session
 * rolling summary of the older half of the conversation and only pass the
 * recent verbatim chunk through.
 *
 * The summary is regenerated whenever a meaningful chunk of new speech has
 * accumulated since the last refresh.
 */

interface CacheEntry {
  /** Cached summary of speech BEFORE `summaryBaseCharCount`. */
  summary: string;
  /** Number of total transcript chars at the time we generated the summary. */
  summaryBaseCharCount: number;
  /** When the summary was generated (epoch ms). */
  generatedAt: number;
}

const cache = new Map<number, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;

/** Recompute summary when this many new chars have accumulated since the last run. */
const REFRESH_AFTER_CHARS = 2000;
/** ... or this much wall-clock time has passed since the last refresh. */
const REFRESH_AFTER_MS = 5 * 60_000;
/** Only bother summarizing when total transcript exceeds this. */
const MIN_CHARS_FOR_SUMMARY = 1800;

const SUMMARY_PROMPT = `You are condensing a LONG meeting transcript so a coach who joined late can read it in seconds. Summarize the conversation so far in 6-10 dense bullet points, in the SAME LANGUAGE as the transcript. Each bullet must capture ONE concrete fact, name, number, decision, open question, or recurring theme. Preserve who said what when it matters. No fluff, no headers, no markdown — just one bullet per line, prefixed with "•".`;

/** Generate a fresh summary of the supplied "older" transcript text. */
async function summarize(olderText: string): Promise<string | null> {
  if (!llmConfigured) return null;
  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 800,
      temperature: 0.2,
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: olderText },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() || "";
    return text || null;
  } catch (err) {
    logger.warn({ err }, "[CONV-CTX] summarize failed");
    return null;
  }
}

/** Trim the cache when it grows too large (just drop the oldest entries). */
function trimCacheIfNeeded() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Drop the 50 oldest entries by generatedAt
  const sorted = Array.from(cache.entries()).sort((a, b) => a[1].generatedAt - b[1].generatedAt);
  for (let i = 0; i < 50 && i < sorted.length; i++) {
    cache.delete(sorted[i][0]);
  }
}

export interface ConversationContext {
  /** Minutes since the first transcript line. */
  ageMinutes: number;
  /** Bullet-point summary of speech BEFORE `recentText`. May be null when the
      conversation is still short enough to fit recent verbatim alone. */
  olderSummary: string | null;
  /** The last ~2500 chars of speech, verbatim and ordered chronologically. */
  recentText: string;
  /** Total chars across the whole conversation so far. */
  totalChars: number;
}

interface BuildOpts {
  sessionId: number;
  sessionStartedAtMs: number;
  /** Whole transcript, ordered chronologically as a single string. */
  fullText: string;
  /** How many chars to keep verbatim at the end. */
  recentChars: number;
}

/**
 * Build a ConversationContext for a session, using or refreshing the cached
 * summary as needed.
 */
export async function buildConversationContext(opts: BuildOpts): Promise<ConversationContext> {
  const { sessionId, sessionStartedAtMs, fullText, recentChars } = opts;
  const totalChars = fullText.length;
  const ageMinutes = Math.max(0, (Date.now() - sessionStartedAtMs) / 60000);

  // Short conversations don't need a rolling summary — recent IS everything.
  if (totalChars <= MIN_CHARS_FOR_SUMMARY) {
    return { ageMinutes, olderSummary: null, recentText: fullText, totalChars };
  }

  // Split: keep the last `recentChars` chars verbatim, summarise the rest.
  const cutoff = Math.max(0, totalChars - recentChars);
  const olderText = fullText.slice(0, cutoff);
  const recentText = fullText.slice(cutoff);

  const now = Date.now();
  const cached = cache.get(sessionId);

  // Reuse the cached summary if it covers most of the older text and was
  // generated recently.
  if (
    cached &&
    cached.summaryBaseCharCount >= cutoff - REFRESH_AFTER_CHARS &&
    now - cached.generatedAt < REFRESH_AFTER_MS
  ) {
    return { ageMinutes, olderSummary: cached.summary, recentText, totalChars };
  }

  // (Re-)generate. If summarization fails (e.g. rate-limit), fall back to a
  // truncated verbatim slice so the engine still has something to work with.
  const fresh = await summarize(olderText.slice(-12000)); // cap input size
  const olderSummary = fresh ?? olderText.slice(-1200);
  if (fresh) {
    cache.set(sessionId, {
      summary: fresh,
      summaryBaseCharCount: cutoff,
      generatedAt: now,
    });
    trimCacheIfNeeded();
  }

  return { ageMinutes, olderSummary, recentText, totalChars };
}

/** Cheap heuristic — does the new text contain a question that warrants a
 * reactive insight? Mirrors how a human advisor knows "they're asking me
 * something, I should answer fast" without burning an LLM call. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  // German / English question openers — case-insensitive on the first 4 words
  const head = t.toLowerCase().slice(0, 80);
  const triggers = [
    "was ", "wer ", "wie ", "wo ", "wann ", "warum ", "wieso ", "weshalb ",
    "welche ", "welcher ", "welches ", "wozu ", "kannst du ", "können wir ",
    "what ", "who ", "when ", "where ", "why ", "how ", "which ",
    "could you ", "can you ", "should we ",
  ];
  return triggers.some((q) => head.includes(q));
}
