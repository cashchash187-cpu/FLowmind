import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usageTable = pgTable("usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  planName: text("plan_name").notNull().default("free"),
  audioMinutesUsed: integer("audio_minutes_used").notNull().default(0),
  audioMinutesLimit: integer("audio_minutes_limit").notNull().default(60),
  aiRequestsUsed: integer("ai_requests_used").notNull().default(0),
  aiRequestsLimit: integer("ai_requests_limit").notNull().default(20),
  researchRequestsUsed: integer("research_requests_used").notNull().default(0),
  researchRequestsLimit: integer("research_requests_limit").notNull().default(0),
  billingPeriodEnd: timestamp("billing_period_end", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const usageHistoryTable = pgTable("usage_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  date: text("date").notNull(),
  audioMinutes: integer("audio_minutes").notNull().default(0),
  aiRequests: integer("ai_requests").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUsageSchema = createInsertSchema(usageTable).omit({
  id: true,
  updatedAt: true,
});

export const insertUsageHistorySchema = createInsertSchema(usageHistoryTable).omit({
  id: true,
  createdAt: true,
});

export type InsertUsage = z.infer<typeof insertUsageSchema>;
export type Usage = typeof usageTable.$inferSelect;
export type UsageHistory = typeof usageHistoryTable.$inferSelect;
