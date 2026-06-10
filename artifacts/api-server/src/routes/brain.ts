import { Router, type IRouter } from "express";
import { eq, and, desc, asc, gte } from "drizzle-orm";
import { db, memosTable, memoPagesTable, remindersTable } from "@workspace/db";
import { processMemo } from "../lib/memo-agent";
import { llmConfigured } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// ── Memos ────────────────────────────────────────────────────────────────────

// POST /api/memos — record a memo; the agent files it synchronously so the
// UI can immediately show WHERE it landed ("→ Privat / Geburtstage").
router.post("/memos", async (req, res): Promise<void> => {
  const user = req.user!;
  const { text, source } = (req.body ?? {}) as { text?: string; source?: string };

  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text required" });
    return;
  }
  if (text.length > 8000) {
    res.status(400).json({ error: "memo too long (max 8000 chars)" });
    return;
  }
  if (!llmConfigured) {
    res.status(503).json({ error: "ai_not_configured", message: "Memory requires the AI to be configured." });
    return;
  }

  try {
    const result = await processMemo(user.id, text, source === "voice" ? "voice" : "text");
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "[BRAIN] memo processing failed");
    res.status(502).json({ error: "memo_processing_failed", message: "Could not file the memo. It was saved — try again later." });
  }
});

// GET /api/memos/recent — latest raw memos (newest first)
router.get("/memos/recent", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(memosTable)
    .where(eq(memosTable.userId, req.user!.id))
    .orderBy(desc(memosTable.createdAt))
    .limit(20);
  res.json(rows);
});

// ── Pages ────────────────────────────────────────────────────────────────────

// GET /api/brain/pages — folder tree: { folder: [{id,title,updatedAt}] }
router.get("/brain/pages", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: memoPagesTable.id,
      folder: memoPagesTable.folder,
      title: memoPagesTable.title,
      updatedAt: memoPagesTable.updatedAt,
    })
    .from(memoPagesTable)
    .where(eq(memoPagesTable.userId, req.user!.id))
    .orderBy(asc(memoPagesTable.folder), desc(memoPagesTable.updatedAt));
  res.json(rows);
});

// GET /api/brain/pages/:id — full page
router.get("/brain/pages/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [page] = await db
    .select()
    .from(memoPagesTable)
    .where(and(eq(memoPagesTable.id, id), eq(memoPagesTable.userId, req.user!.id)))
    .limit(1);
  if (!page) { res.status(404).json({ error: "Page not found" }); return; }
  res.json(page);
});

// PATCH /api/brain/pages/:id — manual edits (content / title / folder)
router.patch("/brain/pages/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { content, title, folder } = (req.body ?? {}) as { content?: string; title?: string; folder?: string };

  const updates: Record<string, string> = {};
  if (typeof content === "string") updates.content = content.slice(0, 64_000);
  if (typeof title === "string" && title.trim()) updates.title = title.trim().slice(0, 120);
  if (typeof folder === "string" && folder.trim()) updates.folder = folder.trim().slice(0, 60);
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }

  const [page] = await db
    .update(memoPagesTable)
    .set(updates)
    .where(and(eq(memoPagesTable.id, id), eq(memoPagesTable.userId, req.user!.id)))
    .returning();
  if (!page) { res.status(404).json({ error: "Page not found" }); return; }
  res.json(page);
});

// DELETE /api/brain/pages/:id
router.delete("/brain/pages/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const deleted = await db
    .delete(memoPagesTable)
    .where(and(eq(memoPagesTable.id, id), eq(memoPagesTable.userId, req.user!.id)))
    .returning({ id: memoPagesTable.id });
  if (!deleted.length) { res.status(404).json({ error: "Page not found" }); return; }
  res.sendStatus(204);
});

// ── Reminders ────────────────────────────────────────────────────────────────

// GET /api/reminders — open reminders, soonest first. ?all=1 includes done.
router.get("/reminders", async (req, res): Promise<void> => {
  const includeAll = req.query.all === "1";
  const where = includeAll
    ? eq(remindersTable.userId, req.user!.id)
    : and(eq(remindersTable.userId, req.user!.id), eq(remindersTable.done, false));
  const rows = await db
    .select()
    .from(remindersTable)
    .where(where)
    .orderBy(asc(remindersTable.dueAt))
    .limit(50);
  res.json(rows);
});

// PATCH /api/reminders/:id — toggle done
router.patch("/reminders/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { done } = (req.body ?? {}) as { done?: boolean };
  const [row] = await db
    .update(remindersTable)
    .set({ done: done === true })
    .where(and(eq(remindersTable.id, id), eq(remindersTable.userId, req.user!.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Reminder not found" }); return; }
  res.json(row);
});

export default router;
