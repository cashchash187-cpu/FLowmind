import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userSessionsTable = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  jti: text("jti").notNull().unique(),
  userId: integer("user_id").notNull(),
  deviceLabel: text("device_label"),
  ip: text("ip"),
  uaLabel: text("ua_label"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const authAttemptsTable = pgTable("auth_attempts", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull(),
  scope: text("scope").notNull().default("password"),
  ip: text("ip"),
  success: boolean("success").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lockoutsTable = pgTable("lockouts", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  scope: text("scope").notNull().default("password"),
  failCount: integer("fail_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const emailCodesTable = pgTable("email_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  purpose: text("purpose").notNull().default("login"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activationCodesTable = pgTable("activation_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  plan: text("plan").notNull(),
  durationDays: integer("duration_days").notNull().default(365),
  redeemedBy: integer("redeemed_by"),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const devicesTable = pgTable("devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  label: text("label"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const securityEventsTable = pgTable("security_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  type: text("type").notNull(),
  ip: text("ip"),
  uaLabel: text("ua_label"),
  meta: text("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSessionSchema = createInsertSchema(userSessionsTable).omit({ id: true });
export const insertAuthAttemptSchema = createInsertSchema(authAttemptsTable).omit({ id: true });
export const insertLockoutSchema = createInsertSchema(lockoutsTable).omit({ id: true });
export const insertEmailCodeSchema = createInsertSchema(emailCodesTable).omit({ id: true });
export const insertActivationCodeSchema = createInsertSchema(activationCodesTable).omit({ id: true });
export const insertDeviceSchema = createInsertSchema(devicesTable).omit({ id: true });
export const insertSecurityEventSchema = createInsertSchema(securityEventsTable).omit({ id: true });

export type UserSession = typeof userSessionsTable.$inferSelect;
export type AuthAttempt = typeof authAttemptsTable.$inferSelect;
export type Lockout = typeof lockoutsTable.$inferSelect;
export type EmailCode = typeof emailCodesTable.$inferSelect;
export type ActivationCode = typeof activationCodesTable.$inferSelect;
export type Device = typeof devicesTable.$inferSelect;
export type SecurityEvent = typeof securityEventsTable.$inferSelect;
