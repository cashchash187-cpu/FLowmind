import type { Request, Response, NextFunction } from "express";
import { verifyToken, COOKIE_SESSION } from "../lib/jwt";
import { db } from "@workspace/db";
import { usersTable, userSessionsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      user: {
        id: number;
        username: string;
        email: string | null;
        displayName: string;
        plan: string;
        isAdmin: boolean;
        passwordMustChange: boolean;
        googleSub: string | null;
        emailLoginEnabled: boolean;
      };
      jti: string;
      authViaCookie: boolean;
    }
  }
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Try cookie first, then Authorization: Bearer header
  const cookieToken = req.cookies?.[COOKIE_SESSION];
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const token = cookieToken ?? bearerToken;
  const viaCookie = !!cookieToken;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  // CSRF check for cookie-based mutations (skip for Bearer token clients)
  if (viaCookie && MUTATION_METHODS.has(req.method)) {
    const csrfHeader = req.headers["x-fm-csrf"] as string | undefined;
    if (!csrfHeader || csrfHeader !== payload.csrf) {
      res.status(403).json({ error: "CSRF validation failed" });
      return;
    }
  }

  const session = await db
    .select()
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.jti, payload.jti), isNull(userSessionsTable.revokedAt)))
    .limit(1);

  if (!session.length) {
    res.status(401).json({ error: "Session revoked" });
    return;
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.sub))
    .limit(1);

  if (!users.length) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const user = users[0];

  // Update last_seen_at for session (fire-and-forget)
  db.update(userSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(userSessionsTable.jti, payload.jti))
    .catch(() => {});

  req.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    plan: user.plan,
    isAdmin: user.isAdmin,
    passwordMustChange: user.passwordMustChange,
    googleSub: user.googleSub,
    emailLoginEnabled: user.emailLoginEnabled,
  };
  req.jti = payload.jti;
  req.authViaCookie = viaCookie;

  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.isAdmin && req.user?.plan !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
