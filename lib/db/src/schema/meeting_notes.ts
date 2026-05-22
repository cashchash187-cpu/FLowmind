import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const meetingNotesTable = pgTable("meeting_notes", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().unique(),
  summary: text("summary").notNull().default(""),
  actionItems: text("action_items").array().notNull().default([]),
  decisions: text("decisions").array().notNull().default([]),
  openQuestions: text("open_questions").array().notNull().default([]),
  keyInsights: text("key_insights").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMeetingNotesSchema = createInsertSchema(meetingNotesTable).omit({
  id: true,
  updatedAt: true,
});

export type InsertMeetingNotes = z.infer<typeof insertMeetingNotesSchema>;
export type MeetingNotes = typeof meetingNotesTable.$inferSelect;
