import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { openai, LLM_MODEL, llmConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

/**
 * Persistent advisor-context profile per user — distilled from the briefs
 * of the user's recent sessions. The idea: instead of asking the user to
 * fill out a "who are you / what do you do" form, we just learn it from
 * their meeting history and feed a 4-6 line summary into every future
 * insight prompt as the assistant's persistent knowledge of "who I'm
 * helping".
 *
 * Refresh rules (best-effort, never blocks the request path):
 *  - generated lazily after a user has 3+ sessions with briefs
 *  - refreshed once they've finished 3 NEW sessions since the last refresh
 *  - or once 7 days have passed since the last refresh
 *  - skipped entirely if LLM isn't configured
 */

const MIN_SESSIONS_FOR_PROFILE = 3;
const REFRESH_AFTER_NEW_SESSIONS = 3;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Cache in-memory so the insight ticker doesn't hit the DB every 2s. */
const cache = new Map<number, { summary: string | null; at: number }>();
const CACHE_TTL_MS = 60_000;

const PROFILE_PROMPT = `You are distilling a single user's professional profile from the meeting briefs of their recent sessions.

You will receive a JSON array of session briefs. Each brief has: topic, userRole, goal, participants, language. Some briefs may be partial or low-quality — weigh patterns over single mentions.

Write a 4-6 LINE profile of who this user is professionally. This profile gets injected into EVERY future insight prompt as the persistent context for the AI advisor sitting next to them. So it must be specific, dry, factual.

Lines should cover (in this order, omit a line if you have no signal):
1. Their role / job function (one short sentence).
2. The industry / company context (one short sentence).
3. Who they typically meet with (counterpart type).
4. Recurring themes / topics across meetings.
5. Default language they conduct meetings in.
6. One distinctive working pattern if visible (e.g. "asks discovery questions early", "presents pricing in the first half").

NO bullet markers, NO headers, NO markdown — just 4-6 short lines separated by newlines. Same language as the user's meetings (German if most briefs are German, English otherwise).

If the briefs are too thin to say anything meaningful, write a single line: "(profile pending — not enough data yet)".`;

interface BriefLike {
  topic?: string;
  userRole?: string;
  goal?: string;
  language?: string;
  participants?: { label?: string; hint?: string }[];
}

async function callLlmForProfile(briefs: BriefLike[]): Promise<string | null> {
  if (!llmConfigured) return null;
  try {
    const trimmed = briefs.slice(0, 12).map((b) => ({
      topic: b.topic?.slice(0, 200) ?? "",
      userRole: b.userRole?.slice(0, 200) ?? "",
      goal: b.goal?.slice(0, 200) ?? "",
      language: b.language ?? "",
      participants: (b.participants ?? []).slice(0, 4).map((p) => ({
        label: p.label ?? "",
        hint: p.hint?.slice(0, 120) ?? "",
      })),
    }));

    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 600,
      temperature: 0.3,
      messages: [
        { role: "system", content: PROFILE_PROMPT },
        { role: "user", content: `Recent briefs (newest first):\n${JSON.stringify(trimmed, null, 2)}` },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return null;
    return text.slice(0, 1500);
  } catch (err) {
    logger.warn({ err }, "[USER-PROFILE] LLM call failed");
    return null;
  }
}

/**
 * Returns the user's persistent profile summary if available — otherwise
 * triggers a generation IN THE BACKGROUND and returns null synchronously.
 *
 * The ticker calls this every tick, but the heavy LLM work fires at most
 * once per refresh cycle.
 */
export async function ensureUserProfile(userId: number): Promise<string | null> {
  try {
    const now = Date.now();
    const cached = cache.get(userId);
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.summary;

    const [user] = await db
      .select({
        id: usersTable.id,
        profileSummary: usersTable.profileSummary,
        profileSummaryGeneratedAt: usersTable.profileSummaryGeneratedAt,
        profileSessionCount: usersTable.profileSessionCount,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      cache.set(userId, { summary: null, at: now });
      return null;
    }

    // Count this user's sessions cheaply.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, userId));

    const sessionCount = Number(count) || 0;
    const needsInitial = !user.profileSummary && sessionCount >= MIN_SESSIONS_FOR_PROFILE;
    const newSessionsSinceLast = sessionCount - (user.profileSessionCount ?? 0);
    const ageMs = user.profileSummaryGeneratedAt
      ? now - new Date(user.profileSummaryGeneratedAt).getTime()
      : Infinity;
    const needsRefresh = !!user.profileSummary && (newSessionsSinceLast >= REFRESH_AFTER_NEW_SESSIONS || ageMs >= REFRESH_AFTER_MS);

    if (!needsInitial && !needsRefresh) {
      cache.set(userId, { summary: user.profileSummary, at: now });
      return user.profileSummary;
    }

    // We need to (re)generate. Pull the user's most recent session briefs.
    const briefRows = await db
      .select({ brief: sessionsTable.brief })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, userId))
      .orderBy(desc(sessionsTable.createdAt))
      .limit(10);

    const briefs = briefRows
      .map((r) => (r.brief && typeof r.brief === "object" ? (r.brief as BriefLike) : null))
      .filter((b): b is BriefLike => !!b && (!!b.topic || !!b.userRole || !!b.goal));

    if (briefs.length < MIN_SESSIONS_FOR_PROFILE) {
      // Not enough briefs yet — return what we have (likely null).
      cache.set(userId, { summary: user.profileSummary, at: now });
      return user.profileSummary;
    }

    const fresh = await callLlmForProfile(briefs);
    if (!fresh) {
      // LLM unavailable — keep returning the previous summary if any.
      cache.set(userId, { summary: user.profileSummary, at: now });
      return user.profileSummary;
    }

    await db
      .update(usersTable)
      .set({
        profileSummary: fresh,
        profileSummaryGeneratedAt: new Date(now),
        profileSessionCount: sessionCount,
      })
      .where(eq(usersTable.id, userId));

    cache.set(userId, { summary: fresh, at: now });
    logger.info({ userId, sessionCount }, "[USER-PROFILE] generated");
    return fresh;
  } catch (err) {
    logger.warn({ err, userId }, "[USER-PROFILE] ensureUserProfile failed");
    return null;
  }
}

/** Fire-and-forget convenience for routes that don't want to await. */
export function refreshUserProfileInBackground(userId: number): void {
  ensureUserProfile(userId).catch((err) => {
    logger.warn({ err, userId }, "[USER-PROFILE] background refresh failed");
  });
}
