import { db } from "@workspace/db";
import { sessionsTable, transcriptsTable, aiAssistsTable, usersTable, researchResultsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { generateInsight } from "./insight-engine";
import { isResearchAvailable, research } from "./research-provider";
import { getPlanLimits } from "./plans";
import { logger } from "./logger";

const TICK_INTERVAL_MS = 8_000;         // check every 8s — closer to the "every 15s" feel the user wants
const MIN_CHARS_SINCE_LAST = 60;        // >=60 new chars of speech required (was 150 — too gated)
const MIN_SECONDS_SINCE_LAST = 15;      // >=15s between insights (also protects free-tier LLM quota)
const HEARTBEAT_STALE_MS = 90_000;      // session considered idle if hb > 90s ago
const RECENT_TRANSCRIPT_CHARS = 1600;   // chars of recent speech to send to the LLM

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
const MIN_SECONDS_BETWEEN_RESEARCH = 90; // auto-research cooldown per user

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

      // 6. Ask the LLM whether a tip is warranted (null => stay silent)
      const insight = await generateInsight(recentText);

      // Advance the char baseline even on silence, so we wait for genuinely new
      // speech before asking again (avoids re-querying the same context).
      tickEntry.charCountAtLastInsight = currentCharCount;
      if (!insight) return;

      // 7. Persist the insight
      await db.insert(aiAssistsTable).values({
        sessionId: session.id,
        mode: "insight",
        suggestion: insight.tip,
        category: insight.category,
        status: "new",
      });
      tickEntry.lastInsightAt = now;

      // 8. Auto-research when the LLM flagged it as needed
      if (
        insight.needsResearch &&
        insight.researchQuery &&
        isResearchAvailable() &&
        now - tickEntry.lastResearchAt >= MIN_SECONDS_BETWEEN_RESEARCH * 1000
      ) {
        const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        const limits = user ? getPlanLimits(user.plan) : getPlanLimits("free");
        const researchAllowed = !!user && (user.isAdmin || limits.researchRequests > 0);

        if (researchAllowed) {
          tickEntry.lastResearchAt = now;
          try {
            const result = await research(insight.researchQuery);
            await db.insert(researchResultsTable).values({
              sessionId: session.id,
              userId,
              query: insight.researchQuery,
              answer: result.answer,
              sources: result.sources as unknown as Record<string, unknown>[],
              trigger: "auto",
              status: "ok",
            });
          } catch (err) {
            logger.error({ err, userId }, "[INSIGHT-TICKER] Auto-research failed");
          }
        }
      }
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
