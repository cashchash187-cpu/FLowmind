import jwt from "jsonwebtoken";
import { randomUUID, randomBytes } from "crypto";

// New canonical name: AUTH_JWT_SECRET. Legacy JWT_SECRET kept for older deploys.
// In production the secret MUST be configured — we refuse to start with the
// dev fallback so we never sign tokens with a known-bad value in the wild.
const SECRET = (() => {
  const fromEnv = process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_JWT_SECRET is required in production (>=16 chars). Refusing to start with a dev fallback.",
    );
  }
  return "flowmind-dev-secret-change-in-prod";
})();
const EXPIRY = "7d";

export interface JwtPayload {
  sub: number;
  jti: string;
  csrf: string;
  iat?: number;
  exp?: number;
}

export function signToken(userId: number, jti?: string): { token: string; csrf: string } {
  const csrf = randomBytes(24).toString("hex");
  const tokenJti = jti ?? randomUUID();
  const payload: JwtPayload = { sub: userId, jti: tokenJti, csrf };
  const token = jwt.sign(payload, SECRET, { expiresIn: EXPIRY });
  return { token, csrf };
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as unknown as JwtPayload;
}

export const COOKIE_SESSION = "fm_session";
export const COOKIE_CSRF = "fm_csrf";
export const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
