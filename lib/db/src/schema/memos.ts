import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Memory ("second brain") ──────────────────────────────────────────────────
// Voice/text memos that an LLM agent automatically files into a living
// folder/page system. Pages are plain markdown the agent rewrites as new
// related memos arrive; reminders are date-anchored extracts surfaced on
// the dashboard.

export const memosTable = pgTable("memos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  rawText: text("raw_text").notNull(),
  source: text("source").notNull().default("text"), // "voice" | "text"
  status: text("status").notNull().default("processed"), // processed | failed
  // Page the agent filed this memo into (null when processing failed).
  pageId: integer("page_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memoPagesTable = pgTable("memo_pages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // Flat folder name ("Privat", "Arbeit", "Projekte"…). The agent invents
  // and reuses folders on its own; users can rename via PATCH.
  folder: text("folder").notNull(),
  title: text("title").notNull(),
  // Markdown body — fully rewritten by the agent when new memos merge in.
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const remindersTable = pgTable("reminders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  label: text("label").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  done: boolean("done").notNull().default(false),
  memoId: integer("memo_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMemoSchema = createInsertSchema(memosTable).omit({ id: true, createdAt: true });
export type InsertMemo = z.infer<typeof insertMemoSchema>;
export type Memo = typeof memosTable.$inferSelect;
export type MemoPage = typeof memoPagesTable.$inferSelect;
export type Reminder = typeof remindersTable.$inferSelect;
