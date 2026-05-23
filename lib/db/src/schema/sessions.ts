import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  title: text("title").notNull(),
  status: text("status").notNull().default("active"),
  mode: text("mode"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  speakerCount: integer("speaker_count").notNull().default(0),
  transcriptCount: integer("transcript_count").notNull().default(0),
  summary: text("summary"),
  // Folder this session sits in. null = root (un-foldered).
  folderId: integer("folder_id"),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

// Folders are per-user, flat (no nesting for now — keep it simple).
export const foldersTable = pgTable("folders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  // Sort order within the user's root list.
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFolderSchema = createInsertSchema(foldersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type Folder = typeof foldersTable.$inferSelect;

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
