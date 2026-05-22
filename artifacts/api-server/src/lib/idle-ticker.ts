import { db } from "@workspace/db";
import { sessionsTable } from "@workspace/db";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

export function startIdleTicker() {
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes

      const result = await db
        .update(sessionsTable)
        .set({ status: "idle" })
        .where(
          and(
            eq(sessionsTable.status, "active"),
            isNotNull(sessionsTable.lastHeartbeatAt),
            lt(sessionsTable.lastHeartbeatAt, cutoff)
          )
        )
        .returning({ id: sessionsTable.id });

      if (result.length) {
        logger.info({ count: result.length }, "[IDLE-TICKER] Marked sessions as idle");
      }
    } catch (err) {
      logger.error({ err }, "[IDLE-TICKER] Error");
    }
  }, 60_000);
}
