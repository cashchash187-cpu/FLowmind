import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { sessionsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { getPlanLimits } from "../lib/plans";
import { getOrCreateUsage } from "../lib/usage-helpers";

const UPGRADE_URL = "/pricing";

export function enforceUsage(limitType: "audio" | "ai" | "insight" | "concurrent") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Admin: always pass
    if (user.plan === "admin" || user.isAdmin) {
      next();
      return;
    }

    const limits = getPlanLimits(user.plan);

    if (limitType === "insight") {
      if (!limits.insightMode) {
        res.status(402).json({
          error: "upgrade_required",
          limitType: "feature",
          message: "Insight Mode requires a Pro or Business plan.",
          upgradeUrl: UPGRADE_URL,
        });
        return;
      }
      next();
      return;
    }

    if (limitType === "concurrent") {
      const activeSessions = await db
        .select()
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.userId, user.id),
            inArray(sessionsTable.status, ["active", "idle"])
          )
        );

      if (activeSessions.length >= limits.concurrent) {
        res.status(402).json({
          error: "upgrade_required",
          limitType: "concurrent",
          used: activeSessions.length,
          limit: limits.concurrent,
          upgradeUrl: UPGRADE_URL,
        });
        return;
      }
      next();
      return;
    }

    // Per-user usage check (lazy-inits row if missing)
    const usage = await getOrCreateUsage(user.id, user.plan);

    if (limitType === "audio") {
      const { audioMinutesUsed: used, audioMinutesLimit: limit } = usage;
      if (limit !== -1 && used >= limit) {
        res.status(402).json({ error: "upgrade_required", limitType: "audio", used, limit, upgradeUrl: UPGRADE_URL });
        return;
      }
    }

    if (limitType === "ai") {
      const { aiRequestsUsed: used, aiRequestsLimit: limit } = usage;
      if (limit !== -1 && used >= limit) {
        res.status(402).json({ error: "upgrade_required", limitType: "ai", used, limit, upgradeUrl: UPGRADE_URL });
        return;
      }
    }

    next();
  };
}
