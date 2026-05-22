import { db } from "@workspace/db";
import { sessionsTable, transcriptsTable, aiAssistsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { pickScoredInsight } from "./insight-pool";
import { logger } from "./logger";

const TICK_INTERVAL_MS = 10_000;        // check every 10s
const MIN_CHARS_SINCE_LAST = 150;       // ≥150 new chars of speech required
const MIN_SECONDS_SINCE_LAST = 25;      // ≥25s between insights
const HEARTBEAT_STALE_MS = 60_000;      // session considered idle if hb > 60s ago
const RECENT_TRANSCRIPT_CHARS = 600;    // chars to pull for content-scoring

const LOG_INTERVAL_MS = 5 * 60 * 1000;

interface TickerEntry {
  interval: ReturnType<typeof setInterval>;
  lastSessionId: number;
  lastInsightAt: number;
  charCountAtLastInsight: number;
  shownInsightIds: Set<string>;
}

const tickers = new Map<number, TickerEntry>();
const MAX_TICKERS = 500;

setInterval(() => {
  logger.info({ tickerCount: tickers.size }, "[INSIGHT-TICKER] Active tickers");
}, LOG_INTERVAL_MS);

export function startInsightTicker(userId: number, sessionId: number) {
  if (tickers.has(userId)) {
    const entry = tickers.get(userId)!;
    if (entry.lastSessionId !== sessionId) {
      // New session — reset per-session tracking
      entry.lastSessionId = sessionId;
      entry.lastInsightAt = 0;
      entry.charCountAtLastInsight = 0;
      entry.shownInsightIds = new Set();
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
    shownInsightIds: new Set(),
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
        tickEntry.shownInsightIds = new Set();
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

      // 5. Pull recent transcript for content scoring
      const recentRows = await db
        .select({ text: transcriptsTable.text })
        .from(transcriptsTable)
        .where(eq(transcriptsTable.sessionId, session.id))
        .orderBy(desc(transcriptsTable.startMs))
        .limit(20);

      let recentText = recentRows
        .map((r) => r.text)
        .reverse()
        .join(" ");
      if (recentText.length > RECENT_TRANSCRIPT_CHARS) {
        recentText = recentText.slice(-RECENT_TRANSCRIPT_CHARS);
      }

      // 6. Content-score and pick insight (null = nothing relevant → emit nothing)
      const insight = pickScoredInsight(recentText, tickEntry.shownInsightIds);
      if (!insight) return;

      // 7. Insert the insight
      await db.insert(aiAssistsTable).values({
        sessionId: session.id,
        mode: "insight",
        suggestion: insight.text,
        category: insight.category,
        status: "new",
      });

      // 8. Update tracking state
      tickEntry.lastInsightAt = now;
      tickEntry.charCountAtLastInsight = currentCharCount;
      tickEntry.shownInsightIds.add(insight.id);
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
