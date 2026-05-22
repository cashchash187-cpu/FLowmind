import { Router } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  usersTable, userSessionsTable, securityEventsTable, activationCodesTable, lockoutsTable,
} from "@workspace/db";
import { eq, and, isNull, desc, lte, gte, sql } from "drizzle-orm";
import { sendMagicCode } from "../lib/mailer";

const router = Router();

function getIp(req: any): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? "unknown";
}

async function logEvent(userId: number | null, type: string, req: any, meta?: string) {
  await db.insert(securityEventsTable).values({
    userId,
    type,
    ip: getIp(req),
    uaLabel: req.headers["user-agent"] ?? "unknown",
    meta: meta ?? null,
  }).catch(() => {});
}

// GET /api/admin/events
router.get("/admin/events", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const type = req.query.type as string | undefined;
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  const since = req.query.since as string | undefined;

  let query = db.select().from(securityEventsTable).$dynamic();

  const conditions = [];
  if (type) conditions.push(eq(securityEventsTable.type, type));
  if (userId) conditions.push(eq(securityEventsTable.userId, userId));
  if (since) conditions.push(gte(securityEventsTable.createdAt, new Date(since)));

  if (conditions.length) {
    const { and: andOp } = await import("drizzle-orm");
    query = query.where(andOp(...conditions));
  }

  const events = await query.orderBy(desc(securityEventsTable.createdAt)).limit(limit);
  res.json(events);
});

// GET /api/admin/users
router.get("/admin/users", async (req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));

  const result = await Promise.all(
    users.map(async (u) => {
      const [activeSessionsRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(userSessionsTable)
        .where(and(eq(userSessionsTable.userId, u.id), isNull(userSessionsTable.revokedAt)));

      const lockRows = await db
        .select()
        .from(lockoutsTable)
        .where(eq(lockoutsTable.identifier, `login:${u.username}`))
        .limit(1);

      const lock = lockRows[0];
      let lockoutStatus: string | null = null;
      if (lock?.lockedUntil && lock.lockedUntil > new Date()) {
        const secsLeft = Math.ceil((lock.lockedUntil.getTime() - Date.now()) / 1000);
        lockoutStatus = `Locked ${secsLeft}s`;
      }

      return {
        id: u.id,
        username: u.username,
        email: u.email,
        displayName: u.displayName,
        plan: u.plan,
        planExpiresAt: u.planExpiresAt,
        lastLoginAt: u.lastLoginAt,
        lastLoginIp: u.lastLoginIp,
        createdAt: u.createdAt,
        activeSessions: activeSessionsRow?.count ?? 0,
        lockoutStatus,
      };
    })
  );

  res.json(result);
});

// POST /api/admin/users/:id/reset-password
router.post("/admin/users/:id/reset-password", async (req, res) => {
  const userId = Number(req.params.id);
  const users = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (!users.length) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const user = users[0];

  // Generate temp password
  const tempPw = randomUUID().slice(0, 12);

  await db.update(usersTable)
    .set({ passwordHash: null, passwordMustChange: true })
    .where(eq(usersTable.id, userId));

  if (user.email) {
    await sendMagicCode(user.email, tempPw, "login");
  }

  await logEvent(req.user?.id ?? null, "admin_reset_password", req, `target:${userId}`);
  res.json({ ok: true, tempPw: user.email ? null : tempPw });
});

// POST /api/admin/users/:id/revoke-sessions
router.post("/admin/users/:id/revoke-sessions", async (req, res) => {
  const userId = Number(req.params.id);

  await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessionsTable.userId, userId), isNull(userSessionsTable.revokedAt)));

  await logEvent(req.user?.id ?? null, "admin_revoke_sessions", req, `target:${userId}`);
  res.json({ ok: true });
});

// POST /api/admin/users/:id/set-plan
router.post("/admin/users/:id/set-plan", async (req, res) => {
  const userId = Number(req.params.id);
  const { plan, durationDays } = req.body ?? {};

  if (!plan) {
    res.status(400).json({ error: "plan required" });
    return;
  }

  const expiresAt = durationDays
    ? new Date(Date.now() + Number(durationDays) * 86400 * 1000)
    : null;

  await db
    .update(usersTable)
    .set({ plan, planExpiresAt: expiresAt })
    .where(eq(usersTable.id, userId));

  await logEvent(req.user?.id ?? null, "admin_set_plan", req, `target:${userId},plan:${plan}`);
  res.json({ ok: true });
});

// POST /api/admin/codes/generate
router.post("/admin/codes/generate", async (req, res) => {
  const { plan, count = 1, durationDays = 365 } = req.body ?? {};
  if (!plan) {
    res.status(400).json({ error: "plan required" });
    return;
  }

  const n = Math.min(Number(count), 100);
  const codes: string[] = [];

  for (let i = 0; i < n; i++) {
    const planPart = plan.toUpperCase().slice(0, 3);
    const part1 = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const part2 = randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
    const code = `FM-${planPart}-${part1}-${part2}`;
    codes.push(code);

    await db.insert(activationCodesTable).values({
      code,
      plan,
      durationDays: Number(durationDays),
      createdBy: req.user.id,
    });
  }

  res.json(codes);
});

// GET /api/admin/codes
router.get("/admin/codes", async (req, res) => {
  const codes = await db
    .select()
    .from(activationCodesTable)
    .orderBy(desc(activationCodesTable.createdAt))
    .limit(200);

  res.json(codes);
});

export default router;
