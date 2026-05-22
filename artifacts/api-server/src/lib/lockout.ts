import { db } from "@workspace/db";
import { lockoutsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const ESCALATION = [60, 300, 900, 3600, 21600, 86400]; // seconds

export async function checkLockout(identifier: string, scope: string = "password"): Promise<{ locked: boolean; secondsLeft: number }> {
  const rows = await db
    .select()
    .from(lockoutsTable)
    .where(and(eq(lockoutsTable.identifier, identifier), eq(lockoutsTable.scope, scope)))
    .limit(1);

  if (!rows.length) return { locked: false, secondsLeft: 0 };

  const row = rows[0];
  if (!row.lockedUntil) return { locked: false, secondsLeft: 0 };

  const now = new Date();
  if (row.lockedUntil <= now) return { locked: false, secondsLeft: 0 };

  return {
    locked: true,
    secondsLeft: Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000),
  };
}

export async function recordFailure(identifier: string, scope: string = "password"): Promise<void> {
  const rows = await db
    .select()
    .from(lockoutsTable)
    .where(and(eq(lockoutsTable.identifier, identifier), eq(lockoutsTable.scope, scope)))
    .limit(1);

  if (!rows.length) {
    const durationSeconds = ESCALATION[0];
    await db.insert(lockoutsTable).values({
      identifier,
      scope,
      failCount: 1,
      lockedUntil: new Date(Date.now() + durationSeconds * 1000),
    });
    return;
  }

  const row = rows[0];
  const newCount = row.failCount + 1;
  const escalationIndex = Math.min(newCount - 1, ESCALATION.length - 1);
  const durationSeconds = ESCALATION[escalationIndex];

  await db
    .update(lockoutsTable)
    .set({
      failCount: newCount,
      lockedUntil: new Date(Date.now() + durationSeconds * 1000),
    })
    .where(and(eq(lockoutsTable.identifier, identifier), eq(lockoutsTable.scope, scope)));
}

export async function clearLockout(identifier: string, scope: string = "password"): Promise<void> {
  await db
    .delete(lockoutsTable)
    .where(and(eq(lockoutsTable.identifier, identifier), eq(lockoutsTable.scope, scope)));
}
