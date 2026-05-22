import { Router } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  usersTable, userSessionsTable, emailCodesTable, securityEventsTable, activationCodesTable,
} from "@workspace/db";
import { eq, and, isNull, gt, desc, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { sendMagicCode } from "../lib/mailer";
import { toPublicUser } from "./auth";
import { PLAN_LIMITS } from "../lib/plans";

const router = Router();

function getIp(req: any): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? "unknown";
}

function getUaLabel(req: any): string {
  return req.headers["user-agent"] ?? "unknown";
}

async function logEvent(userId: number, type: string, req: any, meta?: string) {
  await db.insert(securityEventsTable).values({
    userId,
    type,
    ip: getIp(req),
    uaLabel: getUaLabel(req),
    meta: meta ?? null,
  }).catch(() => {});
}

// PATCH /api/account/profile
router.patch("/account/profile", requireAuth, async (req, res) => {
  const { displayName } = req.body ?? {};
  if (!displayName?.trim()) {
    res.status(400).json({ error: "displayName required" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ displayName: displayName.trim() })
    .where(eq(usersTable.id, req.user.id))
    .returning();

  res.json(toPublicUser(updated));
});

// PATCH /api/account/username
router.patch("/account/username", requireAuth, async (req, res) => {
  const { username } = req.body ?? {};
  if (!username || !/^[a-z0-9_-]{3,24}$/.test(username)) {
    res.status(400).json({ error: "Username must be 3-24 chars, lowercase letters/numbers/_/-" });
    return;
  }

  const conflict = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.username, username), ne(usersTable.id, req.user.id)))
    .limit(1);

  if (conflict.length) {
    res.status(409).json({ error: "Username taken" });
    return;
  }

  await db.update(usersTable).set({ username }).where(eq(usersTable.id, req.user.id));
  await logEvent(req.user.id, "account_username_changed", req, username);
  res.json({ ok: true });
});

// PATCH /api/account/email
router.patch("/account/email", requireAuth, async (req, res) => {
  const { email } = req.body ?? {};
  if (!email?.includes("@")) {
    res.status(400).json({ error: "valid email required" });
    return;
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(emailCodesTable).values({
    email: email.toLowerCase(),
    codeHash,
    purpose: "change_email",
    expiresAt,
  });

  await sendMagicCode(email, code, "change_email");
  res.status(202).json({ message: "Verification code sent" });
});

// POST /api/account/email/confirm
router.post("/account/email/confirm", requireAuth, async (req, res) => {
  const { email, code } = req.body ?? {};
  if (!email || !code) {
    res.status(400).json({ error: "email and code required" });
    return;
  }

  const pending = await db
    .select()
    .from(emailCodesTable)
    .where(
      and(
        eq(emailCodesTable.email, email.toLowerCase()),
        eq(emailCodesTable.purpose, "change_email"),
        isNull(emailCodesTable.usedAt),
        gt(emailCodesTable.expiresAt, new Date()),
      )
    )
    .limit(10);

  let matched = null;
  for (const row of pending) {
    if (await bcrypt.compare(code, row.codeHash)) {
      matched = row;
      break;
    }
  }

  if (!matched) {
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }

  await db.update(emailCodesTable).set({ usedAt: new Date() }).where(eq(emailCodesTable.id, matched.id));
  await db.update(usersTable).set({ email: email.toLowerCase() }).where(eq(usersTable.id, req.user.id));
  await logEvent(req.user.id, "account_email_changed", req, email);
  res.json({ ok: true });
});

// PATCH /api/account/password
router.patch("/account/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (!newPassword || newPassword.length < 12) {
    res.status(400).json({ error: "Password must be at least 12 characters" });
    return;
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  const user = users[0];

  // Require current password unless forced change or no password set
  if (user.passwordHash && !user.passwordMustChange) {
    if (!currentPassword) {
      res.status(400).json({ error: "currentPassword required" });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Current password incorrect" });
      return;
    }
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(usersTable)
    .set({ passwordHash: newHash, passwordMustChange: false })
    .where(eq(usersTable.id, req.user.id));

  const eventType = user.passwordMustChange ? "password_changed_forced" : "password_changed";
  await logEvent(req.user.id, eventType, req);
  res.json({ ok: true });
});

// PATCH /api/account/email-login
router.patch("/account/email-login", requireAuth, async (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) required" });
    return;
  }

  await db
    .update(usersTable)
    .set({ emailLoginEnabled: enabled })
    .where(eq(usersTable.id, req.user.id));

  const eventType = enabled ? "email_login_enabled" : "email_login_disabled";
  await logEvent(req.user.id, eventType, req);
  res.json({ ok: true });
});

// POST /api/account/link/google
router.post("/account/link/google", requireAuth, async (req, res) => {
  const { idToken } = req.body ?? {};
  if (!idToken) {
    res.status(400).json({ error: "idToken required" });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(400).json({ error: "Google auth not configured" });
    return;
  }

  let googlePayload: any;
  try {
    const { OAuth2Client } = await import("google-auth-library");
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    googlePayload = ticket.getPayload();
  } catch {
    res.status(401).json({ error: "Invalid Google token" });
    return;
  }

  // Check if this google_sub is already used by another account
  const conflict = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.googleSub, googlePayload.sub))
    .limit(1);

  if (conflict.length && conflict[0].id !== req.user.id) {
    res.status(409).json({ error: "This Google account is already linked to another user" });
    return;
  }

  await db
    .update(usersTable)
    .set({ googleSub: googlePayload.sub, googleAvatar: googlePayload.picture ?? null })
    .where(eq(usersTable.id, req.user.id));

  await logEvent(req.user.id, "google_linked", req);
  res.json({ ok: true });
});

// POST /api/account/unlink/google
router.post("/account/unlink/google", requireAuth, async (req, res) => {
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  const user = users[0];

  if (!user.googleSub) {
    res.status(400).json({ error: "No Google account linked" });
    return;
  }

  // Ensure another auth method exists
  if (!user.passwordHash) {
    res.status(400).json({ error: "Cannot unlink Google — no password set. Set a password first." });
    return;
  }

  await db
    .update(usersTable)
    .set({ googleSub: null, googleAvatar: null })
    .where(eq(usersTable.id, req.user.id));

  await logEvent(req.user.id, "google_unlinked", req);
  res.json({ ok: true });
});

// GET /api/account/sessions
router.get("/account/sessions", requireAuth, async (req, res) => {
  const sessions = await db
    .select()
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, req.user.id), isNull(userSessionsTable.revokedAt)))
    .orderBy(desc(userSessionsTable.lastSeenAt));

  res.json(
    sessions.map((s) => ({
      jti: s.jti,
      deviceLabel: s.deviceLabel,
      ip: s.ip,
      uaLabel: s.uaLabel,
      lastSeenAt: s.lastSeenAt,
      createdAt: s.createdAt,
      isCurrent: s.jti === req.jti,
    }))
  );
});

// POST /api/account/sessions/:jti/revoke
router.post("/account/sessions/:jti/revoke", requireAuth, async (req, res) => {
  const jti = req.params.jti as string;

  if (jti === req.jti) {
    res.status(400).json({ error: "Cannot revoke your current session — use logout instead" });
    return;
  }

  const sessions = await db
    .select()
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.jti, jti), eq(userSessionsTable.userId, req.user.id)))
    .limit(1);

  if (!sessions.length) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(userSessionsTable.jti, jti));

  await logEvent(req.user.id, "session_revoked", req, jti);
  res.json({ ok: true });
});

// GET /api/account/security-events
router.get("/account/security-events", requireAuth, async (req, res) => {
  const events = await db
    .select()
    .from(securityEventsTable)
    .where(eq(securityEventsTable.userId, req.user.id))
    .orderBy(desc(securityEventsTable.createdAt))
    .limit(10);

  res.json(events);
});

// POST /api/codes/redeem
router.post("/codes/redeem", requireAuth, async (req, res) => {
  const { code } = req.body ?? {};
  if (!code) {
    res.status(400).json({ error: "code required" });
    return;
  }

  const codes = await db
    .select()
    .from(activationCodesTable)
    .where(eq(activationCodesTable.code, code.toUpperCase()))
    .limit(1);

  if (!codes.length) {
    res.status(404).json({ error: "Code not found" });
    return;
  }

  const activation = codes[0];

  if (activation.redeemedBy) {
    res.status(410).json({ error: "Code already used" });
    return;
  }

  const expiresAt = activation.durationDays
    ? new Date(Date.now() + activation.durationDays * 86400 * 1000)
    : null;

  await db
    .update(usersTable)
    .set({ plan: activation.plan, planExpiresAt: expiresAt })
    .where(eq(usersTable.id, req.user.id));

  await db
    .update(activationCodesTable)
    .set({ redeemedBy: req.user.id, redeemedAt: new Date() })
    .where(eq(activationCodesTable.id, activation.id));

  await logEvent(req.user.id, "plan_upgrade_code", req, `code:${code},plan:${activation.plan}`);
  res.json({ ok: true, plan: activation.plan });
});

export default router;
