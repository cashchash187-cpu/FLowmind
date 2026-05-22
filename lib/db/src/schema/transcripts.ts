import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transcriptsTable = pgTable("transcripts", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  speakerLabel: text("speaker_label").notNull(),
  text: text("text").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms"),
  confidence: real("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTranscriptSchema = createInsertSchema(transcriptsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertTranscript = z.infer<typeof insertTranscriptSchema>;
export type Transcript = typeof transcriptsTable.$inferSelect;
