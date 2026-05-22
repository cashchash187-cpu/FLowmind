import { db } from "@workspace/db";
import { sessionsTable, transcriptsTable, meetingNotesTable, aiAssistsTable, usersTable } from "@workspace/db";
import { eq, lt, and, isNotNull, inArray } from "drizzle-orm";
import { getPlanLimits } from "./plans";
import { logger } from "./logger";

export async function runRetention() {
  try {
    const users = await db.select().from(usersTable);

    for (const user of users) {
      if (user.plan === "admin" || user.isAdmin) continue;

      const limits = getPlanLimits(user.plan);
      if (limits.historyDays === null) continue;

      const cutoff = new Date(Date.now() - limits.historyDays * 86400 * 1000);

      const oldSessions = await db
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.userId, user.id),
            lt(sessionsTable.createdAt, cutoff)
          )
        );

      if (!oldSessions.length) continue;

      const ids = oldSessions.map((s) => s.id);

      await db.delete(aiAssistsTable).where(inArray(aiAssistsTable.sessionId, ids));
      await db.delete(meetingNotesTable).where(inArray(meetingNotesTable.sessionId, ids));
      await db.delete(transcriptsTable).where(inArray(transcriptsTable.sessionId, ids));
      await db.delete(sessionsTable).where(inArray(sessionsTable.id, ids));

      logger.info({ userId: user.id, deletedCount: ids.length }, "[RETENTION] Pruned old sessions");
    }
  } catch (err) {
    logger.error({ err }, "[RETENTION] Error running retention");
  }
}

export function startRetentionLoop() {
  runRetention();
  setInterval(runRetention, 24 * 60 * 60 * 1000);
}
