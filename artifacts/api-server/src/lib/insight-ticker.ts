import { db } from "@workspace/db";
import { sessionsTable, transcriptsTable, aiAssistsTable, usersTable, researchResultsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { decideInsight, synthesizeInsight, fallbackTipFromResearch } from "./insight-engine";
import { isResearchAvailable, research } from "./research-provider";
import { getPlanLimits } from "./plans";
import { logger } from "./logger";

// Cadence is constrained by Gemini's free-tier 10 RPM cap. A single insight
// can fire up to TWO LLM calls (decide + synthesize), so the effective rate
// must stay under 5 insights/min. Combined with the min-seconds gate below
// that gives us a safe ~3-4 insights/min in the worst case.
const TICK_INTERVAL_MS = 12_000;        // check every 12s
const MIN_CHARS_SINCE_LAST = 50;        // >=50 new chars of speech required
const MIN_SECONDS_SINCE_LAST = 18;      // >=18s between insights
const HEARTBEAT_STALE_MS = 120_000;     // session considered idle if hb > 2min ago
const RECENT_TRANSCRIPT_CHARS = 2400;   // chars of recent speech to send to the LLM

const LOG_INTERVAL_MS = 5 * 60 * 1000;

interface TickerEntry {
  interval: ReturnType<typeof setInterval>;
  lastSessionId: number;
  lastInsightAt: number;
  charCountAtLastInsight: number;
  lastResearchAt: number;
}

const tickers = new Map<number, TickerEntry>();
const MAX_TICKERS = 500;
const MIN_SECONDS_BETWEEN_RESEARCH = 30; // auto-research cooldown per user

setInterval(() => {
  logger.info({ tickerCount: tickers.size }, "[INSIGHT-TICKER] Active tickers");
}, LOG_INTERVAL_MS);

export function startInsightTicker(userId: number, sessionId: number) {
  if (tickers.has(userId)) {
    const entry = tickers.get(userId)!;
    if (entry.lastSessionId !== sessionId) {
      entry.lastSessionId = sessionId;
      entry.lastInsightAt = 0;
      entry.charCountAtLastInsight = 0;
      entry.lastResearchAt = 0;
    }
    return;
  }

  if (tickers.size >= MAX_TICKERS) {
    logger.warn({ userId }, "[INSIGHT-TICKER] Max tickers reached, rejecting new entry");
    return;
  }

  const entry: TickerEntry = {
    interval: null as any,
    lastSessionId: sessionId,
    lastInsightAt: 0,
    charCountAtLastInsight: 0,
    lastResearchAt: 0,
  };

  const interval = setInterval(async () => {
    try {
      const tickEntry = tickers.get(userId);
      if (!tickEntry) return;

      // 1. Find the current active insight-mode session for this user
      const [session] = await db
        .select()
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.userId, userId),
            eq(sessionsTable.mode, "insight"),
            eq(sessionsTable.status, "active")
          )
        )
        .orderBy(desc(sessionsTable.updatedAt))
        .limit(1);

      if (!session) {
        clearInsightTicker(userId);
        return;
      }

      // Reset per-session state when session changed
      if (session.id !== tickEntry.lastSessionId) {
        tickEntry.lastSessionId = session.id;
        tickEntry.lastInsightAt = 0;
        tickEntry.charCountAtLastInsight = 0;
        tickEntry.lastResearchAt = 0;
      }

      // 2. Gate: recent heartbeat (< 60s ago)
      const heartbeatAge = session.lastHeartbeatAt
        ? Date.now() - new Date(session.lastHeartbeatAt).getTime()
        : Infinity;
      if (heartbeatAge > HEARTBEAT_STALE_MS) return;

      // 3. Gate: minimum time since last insight
      const now = Date.now();
      if (tickEntry.lastInsightAt > 0 && now - tickEntry.lastInsightAt < MIN_SECONDS_SINCE_LAST * 1000) return;

      // 4. Gate: minimum new transcript chars since last insight
      const [charResult] = await db
        .select({ total: sql<number>`coalesce(sum(length(${transcriptsTable.text})), 0)` })
        .from(transcriptsTable)
        .where(eq(transcriptsTable.sessionId, session.id));

      const currentCharCount = Number(charResult?.total ?? 0);
      const newChars = currentCharCount - tickEntry.charCountAtLastInsight;
      if (newChars < MIN_CHARS_SINCE_LAST) return;

      // 5. Pull recent transcript for the LLM
      const recentRows = await db
        .select({ text: transcriptsTable.text })
        .from(transcriptsTable)
        .where(eq(transcriptsTable.sessionId, session.id))
        .orderBy(desc(transcriptsTable.startMs))
        .limit(25);

      let recentText = recentRows.map((r) => r.text).reverse().join(" ");
      if (recentText.length > RECENT_TRANSCRIPT_CHARS) {
        recentText = recentText.slice(-RECENT_TRANSCRIPT_CHARS);
      }

      // 6. Pass 1 — decide whether to speak and whether facts are needed.
      const decision = await decideInsight(recentText);

      // Advance the char baseline even on silence so we wait for genuinely new
      // speech before re-querying the same context.
      tickEntry.charCountAtLastInsight = currentCharCount;
      if (!decision || !decision.shouldFire) return;

      // 7. Pass 2 — when facts are needed, run research first, then synthesize
      // the actual insight using the lookup results. The user must never see
      // a stub like "check the numbers" — they get the numbers.
      let finalTip = decision.tip ?? "";
      let finalCategory = decision.category;

      if (decision.needsResearch && decision.researchQuery) {
        const cooldownPassed = now - tickEntry.lastResearchAt >= MIN_SECONDS_BETWEEN_RESEARCH * 1000;
        if (!isResearchAvailable()) {
          logger.info({ userId, query: decision.researchQuery }, "[INSIGHT-TICKER] research unavailable");
          if (!finalTip) return; // no tip + no research = nothing to show
        } else if (!cooldownPassed) {
          logger.info({ userId, sinceLast: Math.round((now - tickEntry.lastResearchAt) / 1000) }, "[INSIGHT-TICKER] research cooldown active");
          if (!finalTip) return;
        } else {
          const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
          const limits = user ? getPlanLimits(user.plan) : getPlanLimits("free");
          const researchAllowed = !!user && (user.isAdmin || limits.researchRequests > 0);
          if (!researchAllowed) {
            logger.warn({ userId, plan: user?.plan }, "[INSIGHT-TICKER] research blocked by plan");
            if (!finalTip) return;
          } else {
            tickEntry.lastResearchAt = now;
            logger.info({ userId, sessionId: session.id, query: decision.researchQuery }, "[INSIGHT-TICKER] research start");
            try {
              const result = await research(decision.researchQuery);
              // Persist the research result so the side panel can show it too
              await db.insert(researchResultsTable).values({
                sessionId: session.id,
                userId,
                query: decision.researchQuery,
                answer: result.answer,
                sources: result.sources as unknown as Record<string, unknown>[],
                trigger: "auto",
                status: "ok",
              });
              logger.info({ userId, sessionId: session.id, sources: result.sources.length }, "[INSIGHT-TICKER] research saved");

              const synth = await synthesizeInsight(recentText, result.answer, result.sources);
              if (synth) {
                finalTip = synth.tip;
                finalCategory = synth.category;
              } else {
                // Synth failed (often Gemini rate-limit). Fall back to a
                // direct quote of the Tavily answer instead of going silent.
                const fallback = fallbackTipFromResearch(result.answer, result.sources, "de");
                if (fallback) {
                  finalTip = fallback.tip;
                  finalCategory = fallback.category;
                  logger.info({ userId }, "[INSIGHT-TICKER] used Tavily fallback for tip");
                } else if (!finalTip) {
                  logger.warn({ userId }, "[INSIGHT-TICKER] synthesize + fallback both empty");
                  return;
                }
              }
            } catch (err) {
              logger.error({ err, userId }, "[INSIGHT-TICKER] research failed");
              if (!finalTip) return;
            }
          }
        }
      }

      if (!finalTip) return;

      // 8. Persist the (now fact-grounded) insight
      await db.insert(aiAssistsTable).values({
        sessionId: session.id,
        mode: "insight",
        suggestion: finalTip,
        category: finalCategory,
        status: "new",
      });
      tickEntry.lastInsightAt = now;
    } catch (err) {
      logger.error({ err, userId }, "[INSIGHT-TICKER] Tick error");
    }
  }, TICK_INTERVAL_MS);

  entry.interval = interval;
  tickers.set(userId, entry);
}

export function clearInsightTicker(userId: number) {
  const entry = tickers.get(userId);
  if (entry) {
    clearInterval(entry.interval);
    tickers.delete(userId);
  }
}
