import { Router } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  usersTable, userSessionsTable, emailCodesTable, securityEventsTable, lockoutsTable,
} from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { signToken, COOKIE_SESSION, COOKIE_CSRF, COOKIE_MAX_AGE } from "../lib/jwt";
import { requireAuth } from "../middlewares/requireAuth";
import { checkLockout, recordFailure, clearLockout } from "../lib/lockout";
import { sendMagicCode } from "../lib/mailer";
import { isDisposableEmail } from "../lib/disposable-emails";
import { UAParser } from "ua-parser-js";

const router = Router();

function getIp(req: any): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? "unknown";
}

function getUaLabel(req: any): string {
  const ua = req.headers["user-agent"] ?? "";
  const parser = new UAParser(ua);
  const b = parser.getBrowser();
  const os = parser.getOS();
  return `${b.name ?? "Unknown"} ${b.version ?? ""} on ${os.name ?? "Unknown"}`.trim();
}

function setCookies(res: any, token: string, csrf: string) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_SESSION, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  res.cookie(COOKIE_CSRF, csrf, {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax" as const,
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

function clearCookies(res: any) {
  res.clearCookie(COOKIE_SESSION, { path: "/" });
  res.clearCookie(COOKIE_CSRF, { path: "/" });
}

async function issueToken(userId: number, req: any, res: any) {
  const jti = randomUUID();
  const ip = getIp(req);
  const uaLabel = getUaLabel(req);
  await db.insert(userSessionsTable).values({ jti, userId, ip, uaLabel, deviceLabel: uaLabel });
  const { token, csrf } = signToken(userId, jti);
  setCookies(res, token, csrf);
  return token;
}

async function logEvent(userId: number | null, type: string, req: any, meta?: string) {
  await db.insert(securityEventsTable).values({
    userId,
    type,
    ip: getIp(req),
    uaLabel: getUaLabel(req),
    meta: meta ?? null,
  }).catch(() => {});
}

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "username and password required" });
    return;
  }

  const lockKey = `login:${username.toLowerCase()}`;
  const { locked, secondsLeft } = await checkLockout(lockKey);
  if (locked) {
    res.status(423).json({ error: "Too many attempts", secondsLeft });
    return;
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username.toLowerCase()))
    .limit(1);

  const user = users[0];

  if (!user || !user.passwordHash) {
    await recordFailure(lockKey);
    await logEvent(user?.id ?? null, "login_failure", req, `username:${username}`);
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await recordFailure(lockKey);
    await logEvent(user.id, "login_failure", req);
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  await clearLockout(lockKey);
  await db.update(usersTable).set({ lastLoginAt: new Date(), lastLoginIp: getIp(req) }).where(eq(usersTable.id, user.id));
  const token = await issueToken(user.id, req, res);
  await logEvent(user.id, "login_success", req);
  res.json({ token, user: toPublicUser(user) });
});

// POST /api/auth/google
router.post("/auth/google", async (req, res) => {
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

  let payload: any;
  try {
    const { OAuth2Client } = await import("google-auth-library");
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    res.status(401).json({ error: "Invalid Google token" });
    return;
  }

  if (!payload?.sub) {
    res.status(401).json({ error: "Invalid Google token" });
    return;
  }

  // Check if google_sub already linked to an existing account
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.googleSub, payload.sub))
    .limit(1);

  if (existing.length) {
    const user = existing[0];
    await db.update(usersTable).set({ lastLoginAt: new Date(), lastLoginIp: getIp(req), googleAvatar: payload.picture ?? null }).where(eq(usersTable.id, user.id));
    const token = await issueToken(user.id, req, res);
    await logEvent(user.id, "login_success", req, "google");
    res.json({ token, user: toPublicUser(user) });
    return;
  }

  // Check for email conflict — NEVER auto-link
  if (payload.email) {
    const emailMatch = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, payload.email))
      .limit(1);

    if (emailMatch.length) {
      res.status(409).json({
        error: "email_conflict",
        message: "This email is already associated with a password account. Sign in with your password, then link Google from Account Settings.",
      });
      return;
    }
  }

  // Create new account via Google
  const username = `g_${payload.sub.slice(-8)}`;
  const [newUser] = await db.insert(usersTable).values({
    username,
    email: payload.email ?? null,
    displayName: payload.name ?? payload.email ?? username,
    googleSub: payload.sub,
    googleAvatar: payload.picture ?? null,
    plan: "free",
  }).returning();

  const token = await issueToken(newUser.id, req, res);
  await logEvent(newUser.id, "login_success", req, "google_new");
  res.json({ token, user: toPublicUser(newUser) });
});

// POST /api/auth/email/request
router.post("/auth/email/request", async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }

  if (isDisposableEmail(email)) {
    res.status(400).json({ error: "disposable_email" });
    return;
  }

  const existingUser = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  // If user has password but email_login_enabled=false, block
  if (existingUser.length && existingUser[0].passwordHash && !existingUser[0].emailLoginEnabled) {
    res.status(403).json({
      error: "email_login_disabled",
      message: "This account uses password sign-in. Enable 'Allow email magic-code as backup sign-in method' in Account Settings first.",
    });
    return;
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(emailCodesTable).values({
    email: email.toLowerCase(),
    codeHash,
    purpose: "login",
    expiresAt,
  });

  await sendMagicCode(email, code, "login");
  res.status(202).json({ message: "Code sent" });
});

// POST /api/auth/email/verify
router.post("/auth/email/verify", async (req, res) => {
  const { email, code } = req.body ?? {};
  if (!email || !code) {
    res.status(400).json({ error: "email and code required" });
    return;
  }

  const lockKey = `email:${email.toLowerCase()}`;
  const { locked, secondsLeft } = await checkLockout(lockKey, "email");
  if (locked) {
    res.status(423).json({ error: "Too many attempts", secondsLeft });
    return;
  }

  const pending = await db
    .select()
    .from(emailCodesTable)
    .where(
      and(
        eq(emailCodesTable.email, email.toLowerCase()),
        eq(emailCodesTable.purpose, "login"),
        isNull(emailCodesTable.usedAt),
        gt(emailCodesTable.expiresAt, new Date()),
      )
    )
    .orderBy(emailCodesTable.createdAt)
    .limit(10);

  let matched = null;
  for (const row of pending) {
    if (await bcrypt.compare(code, row.codeHash)) {
      matched = row;
      break;
    }
  }

  if (!matched) {
    await recordFailure(lockKey, "email");
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }

  await clearLockout(lockKey, "email");
  await db.update(emailCodesTable).set({ usedAt: new Date() }).where(eq(emailCodesTable.id, matched.id));

  // Find or create user
  let users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  let user = users[0];

  if (!user) {
    const username = `user_${randomUUID().slice(0, 8)}`;
    const [created] = await db.insert(usersTable).values({
      username,
      email: email.toLowerCase(),
      displayName: email.split("@")[0],
      plan: "free",
      emailLoginEnabled: true,
    }).returning();
    user = created;
  }

  await db.update(usersTable).set({ lastLoginAt: new Date(), lastLoginIp: getIp(req) }).where(eq(usersTable.id, user.id));
  const token = await issueToken(user.id, req, res);
  await logEvent(user.id, "login_success", req, "email_magic");
  res.json({ token, user: toPublicUser(user) });
});

// POST /api/auth/logout
router.post("/auth/logout", requireAuth, async (req, res) => {
  await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(userSessionsTable.jti, req.jti));
  clearCookies(res);
  res.json({ ok: true });
});

// POST /api/auth/logout-all
router.post("/auth/logout-all", requireAuth, async (req, res) => {
  const sessions = await db
    .select()
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, req.user.id), isNull(userSessionsTable.revokedAt)));

  const others = sessions.filter((s) => s.jti !== req.jti);

  if (others.length) {
    for (const s of others) {
      await db.update(userSessionsTable).set({ revokedAt: new Date() }).where(eq(userSessionsTable.jti, s.jti));
    }
  }

  // Re-issue a fresh session for this device
  const newToken = await issueToken(req.user.id, req, res);
  await logEvent(req.user.id, "logout_all", req);
  res.json({ revokedCount: others.length, token: newToken });
});

// GET /api/auth/me
router.get("/auth/me", requireAuth, async (req, res) => {
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  if (!users.length) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json(toPublicUser(users[0], req.jti));
});

function toPublicUser(user: any, currentJti?: string) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.googleAvatar ?? null,
    plan: user.plan,
    planExpiresAt: user.planExpiresAt ?? null,
    isAdmin: user.isAdmin,
    passwordMustChange: user.passwordMustChange,
    googleSub: user.googleSub,
    googleAvatar: user.googleAvatar,
    emailLoginEnabled: user.emailLoginEnabled,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    authMethods: {
      password: !!user.passwordHash,
      google: !!user.googleSub,
      email: !!(user.emailLoginEnabled && user.email),
    },
    ...(currentJti !== undefined ? { currentJti } : {}),
  };
}

export default router;
export { toPublicUser };
