import { db } from "@workspace/db";
import { sessionsTable, transcriptsTable, aiAssistsTable, usersTable, researchResultsTable } from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { decideInsight, synthesizeInsight, fallbackTipFromResearch } from "./insight-engine";
import { buildConversationContext, looksLikeQuestion } from "./conversation-context";
import { isResearchAvailable, research } from "./research-provider";
import { getPlanLimits } from "./plans";
import { logger } from "./logger";

// The ticker checks frequently. The decide() call is cheap (one LLM message);
// expensive work (research, synth) only fires when decide() says shouldFire.
// On a normal meeting the LLM hits ~1 decide/3s = 20/min but most of those
// return shouldFire=false and don't trigger downstream calls.
//
// REACTIVE override: when the newly-arrived text contains a direct question
// we ignore the regular min-seconds-since-last gate and fire within ~3 s.
const TICK_INTERVAL_MS = 3_000;         // check every 3s
const MIN_CHARS_SINCE_LAST = 30;        // >=30 new chars of speech required
const MIN_SECONDS_SINCE_LAST = 8;       // >=8s between strategic insights
const REACTIVE_MIN_SECONDS_SINCE_LAST = 3; // ... but as little as 3s for direct questions
const HEARTBEAT_STALE_MS = 120_000;     // session considered idle if hb > 2min ago
const RECENT_TRANSCRIPT_CHARS = 2500;   // chars of recent speech to send to the LLM

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

      // 2. Gate: recent heartbeat (session considered idle if hb too old).
      const heartbeatAge = session.lastHeartbeatAt
        ? Date.now() - new Date(session.lastHeartbeatAt).getTime()
        : Infinity;
      if (heartbeatAge > HEARTBEAT_STALE_MS) return;

      const now = Date.now();

      // 3. Pull the full transcript (chronological) so we can both detect
      //    new content + feed the full conversation into the LLM context.
      const allRows = await db
        .select({ text: transcriptsTable.text, startMs: transcriptsTable.startMs })
        .from(transcriptsTable)
        .where(eq(transcriptsTable.sessionId, session.id))
        .orderBy(asc(transcriptsTable.startMs));
      const fullText = allRows.map((r) => r.text).join(" ");
      const currentCharCount = fullText.length;

      // Question detection has TWO bands:
      //  - "fresh" — question in speech since the last insight (true
      //    reactive: the question just appeared, demand a fast answer).
      //  - "lingering" — question still visible in the last ~1500 chars of
      //    transcript (likely a compound question whose 2nd part wasn't
      //    answered yet). Lingering questions get the short reactive gate
      //    too so follow-ups arrive within seconds.
      const newSpeech = fullText.slice(tickEntry.charCountAtLastInsight);
      const recentTail = fullText.slice(-1500);
      const reactive = looksLikeQuestion(newSpeech) || looksLikeQuestion(recentTail);

      // 4. Gates. Reactive insights (direct question still in the air) get
      //    a shorter cooldown and a smaller char threshold so they fire fast.
      const minSecondsGate = reactive ? REACTIVE_MIN_SECONDS_SINCE_LAST : MIN_SECONDS_SINCE_LAST;
      const secondsSinceLast = tickEntry.lastInsightAt > 0 ? (now - tickEntry.lastInsightAt) / 1000 : Infinity;
      if (tickEntry.lastInsightAt > 0 && now - tickEntry.lastInsightAt < minSecondsGate * 1000) {
        logger.debug({ userId, sessionId: session.id, secondsSinceLast, gate: minSecondsGate, reactive }, "[INSIGHT-TICKER] time-gate hold");
        return;
      }
      const minCharsGate = reactive ? 0 : MIN_CHARS_SINCE_LAST;
      const newChars = currentCharCount - tickEntry.charCountAtLastInsight;
      if (newChars < minCharsGate) {
        logger.debug({ userId, sessionId: session.id, newChars, gate: minCharsGate, reactive }, "[INSIGHT-TICKER] char-gate hold");
        return;
      }
      logger.info({ userId, sessionId: session.id, reactive, newChars, ageMin: ((now - (allRows[0]?.startMs ?? now)) / 60000).toFixed(1) }, "[INSIGHT-TICKER] decide()");

      // 5. Build the rich conversation context (rolling summary cache).
      const sessionStartedAtMs = session.createdAt
        ? new Date(session.createdAt).getTime()
        : (allRows[0]?.startMs ?? Date.now());
      const ctx = await buildConversationContext({
        sessionId: session.id,
        sessionStartedAtMs,
        fullText,
        recentChars: RECENT_TRANSCRIPT_CHARS,
      });

      // 5b. Last few insights to suppress repeats.
      const recentInsights = await db
        .select({ suggestion: aiAssistsTable.suggestion })
        .from(aiAssistsTable)
        .where(and(eq(aiAssistsTable.sessionId, session.id), eq(aiAssistsTable.mode, "insight")))
        .orderBy(desc(aiAssistsTable.createdAt))
        .limit(6);
      const previousInsightTips = recentInsights.map((r) => r.suggestion).filter(Boolean);

      // 6. Pass 1 — decide whether to speak (and whether facts are needed).
      const decision = await decideInsight({
        ageMinutes: ctx.ageMinutes,
        olderSummary: ctx.olderSummary,
        recentText: ctx.recentText,
        previousInsights: previousInsightTips,
        reactive,
      });

      // Advance the char baseline even on silence so we wait for genuinely
      // new speech before re-querying the same context.
      tickEntry.charCountAtLastInsight = currentCharCount;
      if (!decision) {
        logger.warn({ userId, sessionId: session.id }, "[INSIGHT-TICKER] decide() returned null");
        return;
      }
      if (!decision.shouldFire) {
        logger.info({ userId, sessionId: session.id, needsResearch: decision.needsResearch }, "[INSIGHT-TICKER] decide() said no");
        return;
      }

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

              const synth = await synthesizeInsight(ctx.recentText, result.answer, result.sources);
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

/**
 * Boot-warmer — restart tickers for every active insight session in the DB.
 * Called once on server start. Without this, any deploy silently kills all
 * running insight engines until each session is re-opened by its user.
 */
export async function reviveActiveInsightTickers() {
  try {
    const rows = await db
      .select({ userId: sessionsTable.userId, id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.status, "active"), eq(sessionsTable.mode, "insight")));
    let started = 0;
    for (const r of rows) {
      if (r.userId == null) continue;
      startInsightTicker(r.userId, r.id);
      started++;
    }
    if (started) logger.info({ started }, "[INSIGHT-TICKER] revived active session tickers");
  } catch (err) {
    logger.error({ err }, "[INSIGHT-TICKER] revive on boot failed");
  }
}
