import bcrypt from "bcrypt";
import { db } from "@workspace/db";
import { usersTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const SEED_USERS = [
  { username: "marcel", displayName: "Marcel Admin", password: "Admin1234!!", plan: "admin", isAdmin: true },
  { username: "user1",  displayName: "Demo User 1",  password: "Password1234!", plan: "free",  isAdmin: false },
  { username: "user2",  displayName: "Demo User 2",  password: "Password1234!", plan: "free",  isAdmin: false },
  { username: "user3",  displayName: "Demo User 3",  password: "Password1234!", plan: "pro",   isAdmin: false },
  { username: "user4",  displayName: "Demo User 4",  password: "Password1234!", plan: "free",  isAdmin: false },
];

export async function seedDatabase() {
  try {
    for (const u of SEED_USERS) {
      const existing = await db.select().from(usersTable).where(eq(usersTable.username, u.username)).limit(1);
      if (!existing.length) {
        const passwordHash = await bcrypt.hash(u.password, 12);
        await db.insert(usersTable).values({
          username: u.username,
          displayName: u.displayName,
          passwordHash,
          plan: u.plan,
          isAdmin: u.isAdmin,
          passwordMustChange: true,
        });
        logger.info({ username: u.username }, "[SEED] Created user");
      }
    }

    // Backfill existing sessions with marcel's user_id
    const [marcel] = await db.select().from(usersTable).where(eq(usersTable.username, "marcel")).limit(1);
    if (marcel) {
      await db
        .update(sessionsTable)
        .set({ userId: marcel.id })
        .where(eq(sessionsTable.userId, null as any));
    }
  } catch (err) {
    logger.error({ err }, "[SEED] Error seeding database");
  }
}
