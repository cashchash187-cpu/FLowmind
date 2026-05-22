import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiAssistsTable = pgTable("ai_assists", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  mode: text("mode").notNull(),
  suggestion: text("suggestion").notNull(),
  reasoning: text("reasoning"),
  category: text("category"),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiAssistSchema = createInsertSchema(aiAssistsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAiAssist = z.infer<typeof insertAiAssistSchema>;
export type AiAssist = typeof aiAssistsTable.$inferSelect;
