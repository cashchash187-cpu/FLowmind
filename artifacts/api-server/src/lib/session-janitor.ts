import { db, sessionsTable } from "@workspace/db";
import { and, lt, or, isNull, sql, inArray } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Stale-session janitor. Sessions are supposed to be ended by the user, but
 * in practice many get abandoned: the tab closes, the phone locks, the
 * heartbeat stops — and the row stays "active" (or parks on "idle")
 * forever. Those zombies clutter the Sessions list, keep insight tickers
 * alive, and made the dashboard's "active" counts meaningless (we found
 * 20+ of them in prod).
 *
 * Existing loops don't cover this case: idle-ticker only flips
 * active→idle when a heartbeat EXISTS (sessions that never got one stay
 * "active" forever) and retention skips admin users entirely.
 *
 * Rule: an active/idle session whose last heartbeat (or creation, if it
 * never had one) is older than STALE_AFTER_MS gets flipped to "ended".
 * Runs once at boot and then hourly.
 */

const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 h without a heartbeat
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;   // hourly

export async function sweepStaleSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  try {
    const rows = await db
      .update(sessionsTable)
      .set({ status: "ended", endedAt: sql`COALESCE(${sessionsTable.lastHeartbeatAt}, ${sessionsTable.updatedAt})` })
      .where(
        and(
          inArray(sessionsTable.status, ["active", "idle"]),
          or(
            lt(sessionsTable.lastHeartbeatAt, cutoff),
            // Never had a heartbeat at all AND was created before the cutoff
            and(isNull(sessionsTable.lastHeartbeatAt), lt(sessionsTable.createdAt, cutoff)),
          ),
        ),
      )
      .returning({ id: sessionsTable.id });
    if (rows.length) {
      logger.info({ count: rows.length, ids: rows.map((r) => r.id) }, "[JANITOR] ended stale sessions");
    }
    return rows.length;
  } catch (err) {
    logger.error({ err }, "[JANITOR] stale-session sweep failed");
    return 0;
  }
}

export function startSessionJanitor() {
  // The boot sweep is run (and awaited) by index.ts before insight tickers
  // are revived — here we only schedule the recurring cadence.
  setInterval(() => void sweepStaleSessions(), SWEEP_INTERVAL_MS);
  logger.info({ staleAfterHours: STALE_AFTER_MS / 3_600_000 }, "[JANITOR] session janitor started");
}
