import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  googleSub: text("google_sub").unique(),
  googleAvatar: text("google_avatar"),
  plan: text("plan").notNull().default("free"),
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  emailLoginEnabled: boolean("email_login_enabled").notNull().default(false),
  passwordMustChange: boolean("password_must_change").notNull().default(false),
  isAdmin: boolean("is_admin").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastLoginIp: text("last_login_ip"),
  // Persistent advisor-context profile, distilled from recent session briefs.
  // 4-6 lines describing who this user is professionally — gets injected into
  // every insight prompt so the LLM "knows the user" across meetings without
  // any setup form on the user's side.
  profileSummary: text("profile_summary"),
  profileSummaryGeneratedAt: timestamp("profile_summary_generated_at", { withTimezone: true }),
  // Number of sessions counted when the profile was last regenerated — used
  // to decide when to refresh ("3 new sessions since last refresh").
  profileSessionCount: integer("profile_session_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
