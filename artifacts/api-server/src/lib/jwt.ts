import jwt from "jsonwebtoken";
import { randomUUID, randomBytes } from "crypto";

const SECRET = process.env.JWT_SECRET ?? "flowmind-dev-secret-change-in-prod";
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
