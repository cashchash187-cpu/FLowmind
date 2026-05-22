import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const researchResultsTable = pgTable("research_results", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  userId: integer("user_id").notNull(),
  query: text("query").notNull(),
  answer: text("answer").notNull(),
  sources: jsonb("sources").notNull().default([]),
  trigger: text("trigger").notNull().default("manual"),
  status: text("status").notNull().default("ok"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertResearchResultSchema = createInsertSchema(researchResultsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertResearchResult = z.infer<typeof insertResearchResultSchema>;
export type ResearchResult = typeof researchResultsTable.$inferSelect;

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}
