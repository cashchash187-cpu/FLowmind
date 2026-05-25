import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

/**
 * Auto-derived meeting brief — the LLM reads the first ~2 minutes of speech
 * and extracts who's talking, what the meeting is about, what the user's
 * apparent role is, and what they're trying to achieve.
 *
 * This gets injected into every later insight + research call so the advisor
 * has real situational context — without the user having to fill out any
 * form before the meeting.
 *
 * Cost control: maximum 2 LLM calls per session (initial + one mid-meeting
 * refresh if the meeting takes a sharp pivot).
 */

export interface BriefParticipant {
  /** "Speaker A", "Speaker B", … (or "host" when diarization is off). */
  label: string;
  /** Free-form one-liner: "Host, sales rep at Deutsche Leasing".  */
  hint: string;
}

export interface SessionBrief {
  participants: BriefParticipant[];
  /** One sentence about the meeting subject. */
  topic: string;
  /** One sentence — who the assisted user is and what they're trying to do. */
  userRole: string;
  /** One sentence — the goal of the meeting from the user's perspective. */
  goal: string;
  /** ISO language code derived from the speech ("de", "en", …). */
  language: string;
  /** Epoch ms when the brief was last regenerated. */
  generatedAt: number;
  /** Total transcript chars at generation time — feeds the refresh trigger. */
  baseCharCount: number;
}

interface CacheEntry {
  brief: SessionBrief;
  /** Last time we actually called the LLM (epoch ms) — also lives in brief.generatedAt
   *  but we duplicate here so the cache can be checked without touching the brief. */
  generatedAt: number;
  generationCount: number;
}

const cache = new Map<number, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;

/** Trigger an initial brief once this much speech has accumulated. */
const MIN_CHARS_FOR_INITIAL_BRIEF = 600;
/** Allow one refresh after this many new chars have arrived (themes pivot). */
const REFRESH_AFTER_CHARS = 4000;
/** Hard cap: never regenerate more than this many times per session. */
const MAX_GENERATIONS_PER_SESSION = 2;
/** And never refresh sooner than this since the previous generation. */
const MIN_MS_BETWEEN_REFRESH = 8 * 60_000;

const BRIEF_PROMPT = `You read the OPENING of a live business meeting and write a SHORT advisor brief that another AI will use to give context-aware tips later.

You receive: the first 2-3 minutes of a transcript (speaker-tagged when diarization is on).

Identify:
1. participants — each distinct speaker. The label is the speaker tag from the transcript ("Speaker A", "Speaker B", …) or "host" if there are no tags. The hint is a SHORT noun phrase (5-12 words) describing who they seem to be ("host, sales rep introducing the product"; "prospect, mid-market CFO evaluating leasing options"). If you can't tell, write "unclear role".
2. topic — ONE sentence on what this meeting is actually about.
3. userRole — ONE sentence describing the person who is BEING ASSISTED. This is almost always the host: whoever introduces themselves first, opens the agenda, presents their company, asks discovery questions, or speaks in a sales-rep / advisor voice. If both speakers seem peer-level, pick whoever is steering the conversation.
4. goal — ONE sentence on what the assisted user is trying to achieve in THIS meeting (close a deal, gather requirements, defend a position, get a decision, …).
5. language — ISO code of the dominant language ("de", "en", "fr", …).

Output ONLY this JSON, no markdown:
{
  "participants": [{"label": "Speaker A", "hint": "..."}, ...],
  "topic": "...",
  "userRole": "...",
  "goal": "...",
  "language": "de"
}

Hard rules:
- All free-form fields in the SAME LANGUAGE as the transcript.
- Be specific. "Sales call" is useless; "Mittelstand leasing pitch to a CFO" is useful.
- If genuinely unclear after 2 min, write "unclear" — better than guessing wildly.
- No more than 4 participants in the output even if Deepgram emitted more.`;

function trimCacheIfNeeded() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const sorted = Array.from(cache.entries()).sort((a, b) => a[1].generatedAt - b[1].generatedAt);
  for (let i = 0; i < 50 && i < sorted.length; i++) cache.delete(sorted[i]![0]);
}

async function callLlmForBrief(transcript: string): Promise<Omit<SessionBrief, "generatedAt" | "baseCharCount"> | null> {
  if (!llmConfigured) return null;
  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 700,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: BRIEF_PROMPT },
        { role: "user", content: `Opening transcript (first speech of the meeting):\n${transcript}` },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() || "";
    if (!raw) return null;
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<SessionBrief>;
    if (!parsed || typeof parsed !== "object") return null;

    const participants = Array.isArray(parsed.participants)
      ? parsed.participants
          .filter((p): p is BriefParticipant => !!p && typeof p === "object" && typeof p.label === "string")
          .map((p) => ({
            label: String(p.label).slice(0, 40),
            hint: typeof p.hint === "string" ? p.hint.slice(0, 200) : "",
          }))
          .slice(0, 4)
      : [];

    return {
      participants,
      topic: typeof parsed.topic === "string" ? parsed.topic.trim().slice(0, 300) : "",
      userRole: typeof parsed.userRole === "string" ? parsed.userRole.trim().slice(0, 300) : "",
      goal: typeof parsed.goal === "string" ? parsed.goal.trim().slice(0, 300) : "",
      language: typeof parsed.language === "string" ? parsed.language.trim().slice(0, 8) : "",
    };
  } catch (err) {
    logger.warn({ err }, "[MEETING-BRIEF] LLM call failed");
    return null;
  }
}

/**
 * Ensure a fresh-enough brief exists for `sessionId`. Returns the brief or
 * null if generation isn't possible / hasn't happened yet (transcript too
 * short, LLM disabled, etc.). Best-effort — never throws.
 */
export async function ensureSessionBrief(sessionId: number, fullText: string): Promise<SessionBrief | null> {
  try {
    const totalChars = fullText.length;
    if (totalChars < MIN_CHARS_FOR_INITIAL_BRIEF) return null;

    const cached = cache.get(sessionId);
    const now = Date.now();

    // Cache hit & still valid — no work needed.
    if (cached) {
      const stillFreshChars = totalChars - cached.brief.baseCharCount < REFRESH_AFTER_CHARS;
      const refreshLockedOut = cached.generationCount >= MAX_GENERATIONS_PER_SESSION;
      const recentlyRefreshed = now - cached.generatedAt < MIN_MS_BETWEEN_REFRESH;
      if (stillFreshChars || refreshLockedOut || recentlyRefreshed) return cached.brief;
    } else {
      // Cold cache — try to load from DB before regenerating.
      const [row] = await db
        .select({ brief: sessionsTable.brief, briefGeneratedAt: sessionsTable.briefGeneratedAt })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .limit(1);
      if (row?.brief && typeof row.brief === "object") {
        const persisted = row.brief as unknown as SessionBrief;
        if (persisted?.topic !== undefined) {
          cache.set(sessionId, {
            brief: persisted,
            generatedAt: row.briefGeneratedAt ? new Date(row.briefGeneratedAt).getTime() : now,
            generationCount: 1, // can still refresh once
          });
          const stillFreshChars = totalChars - (persisted.baseCharCount ?? 0) < REFRESH_AFTER_CHARS;
          if (stillFreshChars) return persisted;
        }
      }
    }

    // Cap input to the LLM at ~6k chars to keep cost predictable.
    const llmResult = await callLlmForBrief(fullText.slice(0, 6000));
    if (!llmResult) {
      // If we already have a brief but the refresh failed, keep the old one.
      if (cached) return cached.brief;
      return null;
    }

    const brief: SessionBrief = {
      ...llmResult,
      generatedAt: now,
      baseCharCount: totalChars,
    };

    const newEntry: CacheEntry = {
      brief,
      generatedAt: now,
      generationCount: (cached?.generationCount ?? 0) + 1,
    };
    cache.set(sessionId, newEntry);
    trimCacheIfNeeded();

    // Persist to DB best-effort.
    try {
      await db
        .update(sessionsTable)
        .set({
          brief: brief as unknown as Record<string, unknown>,
          briefGeneratedAt: new Date(now),
        })
        .where(eq(sessionsTable.id, sessionId));
    } catch (err) {
      logger.warn({ err, sessionId }, "[MEETING-BRIEF] failed to persist brief");
    }

    logger.info({
      sessionId,
      participants: brief.participants.length,
      language: brief.language,
      generation: newEntry.generationCount,
    }, "[MEETING-BRIEF] generated");

    return brief;
  } catch (err) {
    logger.warn({ err, sessionId }, "[MEETING-BRIEF] ensureSessionBrief failed");
    return null;
  }
}

/** Cheap formatter used by the insight prompt assembly. */
export function formatBriefForPrompt(brief: SessionBrief | null | undefined): string {
  if (!brief) return "";
  const parts: string[] = [];
  if (brief.topic) parts.push(`Topic: ${brief.topic}`);
  if (brief.userRole) parts.push(`User: ${brief.userRole}`);
  if (brief.goal) parts.push(`Goal: ${brief.goal}`);
  if (brief.participants.length) {
    parts.push(
      `Participants: ${brief.participants.map((p) => `${p.label} — ${p.hint || "?"}`).join("; ")}`,
    );
  }
  return parts.join("\n");
}

/** Returns the label of the participant identified as "the user" (host).
 *  Used by the insight engine to assign the host's turns as `assistant`
 *  messages and the counterpart's as `user` messages — so the LLM IS the
 *  user, listening to the counterpart. Falls back to null when ambiguous. */
export function inferHostLabel(brief: SessionBrief | null | undefined): string | null {
  if (!brief || !brief.participants.length) return null;
  // The userRole hint usually mentions a speaker label literally. Grep for it.
  const probe = `${brief.userRole} ${brief.goal}`.toLowerCase();
  for (const p of brief.participants) {
    const label = p.label.toLowerCase();
    if (label && probe.includes(label)) return p.label;
  }
  // Heuristic fallback: the first participant whose hint contains words like
  // "host", "sales", "rep", "advisor", "presenting", "introduces", "asks".
  const HOST_WORDS = /\b(host|sales|rep|advisor|account|presenter|presenting|introduce|moderator|interviewer|asks discovery)\b/i;
  for (const p of brief.participants) {
    if (HOST_WORDS.test(p.hint || "")) return p.label;
  }
  // Final fallback: the first labelled participant — usually the speaker who
  // appeared first in the transcript, which is overwhelmingly the host.
  return brief.participants[0]?.label ?? null;
}
