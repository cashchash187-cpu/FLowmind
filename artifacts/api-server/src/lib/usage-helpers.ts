import { db } from "@workspace/db";
import { usageTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getPlanLimits } from "./plans";

/** Lazy-init: fetches per-user usage row, or creates one if missing. */
export async function getOrCreateUsage(userId: number, plan: string) {
  const [existing] = await db
    .select()
    .from(usageTable)
    .where(eq(usageTable.userId, userId))
    .limit(1);

  if (existing) return existing;

  const limits = getPlanLimits(plan);
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 30);

  const [created] = await db
    .insert(usageTable)
    .values({
      userId,
      planName: plan,
      audioMinutesUsed: 0,
      audioMinutesLimit: limits.audioMinutes === Infinity ? -1 : limits.audioMinutes,
      aiRequestsUsed: 0,
      aiRequestsLimit: limits.aiRequests === Infinity ? -1 : limits.aiRequests,
      billingPeriodEnd: periodEnd,
    })
    .returning();

  return created;
}
