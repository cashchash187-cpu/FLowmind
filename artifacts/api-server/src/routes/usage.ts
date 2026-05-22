import { Router, type IRouter } from "express";
import { db, usageHistoryTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getOrCreateUsage } from "../lib/usage-helpers";

const router: IRouter = Router();

router.get("/usage/current", async (req, res): Promise<void> => {
  const usage = await getOrCreateUsage(req.user!.id, req.user!.plan);

  res.json({
    planName: usage.planName,
    audioMinutesUsed: usage.audioMinutesUsed,
    audioMinutesLimit: usage.audioMinutesLimit,
    aiRequestsUsed: usage.aiRequestsUsed,
    aiRequestsLimit: usage.aiRequestsLimit,
    billingPeriodEnd: usage.billingPeriodEnd,
  });
});

router.get("/usage/history", async (req, res): Promise<void> => {
  const history = await db
    .select()
    .from(usageHistoryTable)
    .where(eq(usageHistoryTable.userId, req.user!.id))
    .orderBy(desc(usageHistoryTable.date))
    .limit(30);

  res.json(history);
});

export default router;
