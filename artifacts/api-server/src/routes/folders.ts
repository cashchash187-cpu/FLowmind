import { Router, type IRouter } from "express";
import { eq, and, asc, sql } from "drizzle-orm";
import { db, foldersTable, sessionsTable } from "@workspace/db";

const router: IRouter = Router();

// ─── Tiny inline validators (the api-server has no direct zod dep) ──────────
function parseFolderName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  return trimmed;
}

function parsePosition(input: unknown): number | null {
  if (typeof input !== "number") return null;
  if (!Number.isInteger(input) || input < 0) return null;
  return input;
}

function parseFolderId(input: unknown): number | null | undefined {
  if (input === null) return null;
  if (typeof input === "number" && Number.isInteger(input) && input > 0) return input;
  return undefined;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/folders → all of MY folders ordered by position then name
router.get("/folders", async (req, res) => {
  const userId = req.user!.id;
  const rows = await db
    .select()
    .from(foldersTable)
    .where(eq(foldersTable.userId, userId))
    .orderBy(asc(foldersTable.position), asc(foldersTable.name));
  res.json(rows);
});

// POST /api/folders → create one at the end of my list
router.post("/folders", async (req, res): Promise<void> => {
  const name = parseFolderName(req.body?.name);
  if (name === null) {
    res.status(400).json({ error: "name is required (1-80 chars)" });
    return;
  }
  const userId = req.user!.id;
  // Append at end of the list.
  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`coalesce(max(${foldersTable.position}), -1)` })
    .from(foldersTable)
    .where(eq(foldersTable.userId, userId));
  const [row] = await db
    .insert(foldersTable)
    .values({ userId, name, position: Number(maxPos) + 1 })
    .returning();
  res.status(201).json(row);
});

// PATCH /api/folders/:id → rename or reorder
router.patch("/folders/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const patch: { name?: string; position?: number } = {};
  if (req.body?.name !== undefined) {
    const name = parseFolderName(req.body.name);
    if (name === null) {
      res.status(400).json({ error: "name must be 1-80 chars" });
      return;
    }
    patch.name = name;
  }
  if (req.body?.position !== undefined) {
    const position = parsePosition(req.body.position);
    if (position === null) {
      res.status(400).json({ error: "position must be a non-negative integer" });
      return;
    }
    patch.position = position;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "nothing to update" });
    return;
  }
  const userId = req.user!.id;
  const [existing] = await db
    .select()
    .from(foldersTable)
    .where(and(eq(foldersTable.id, id), eq(foldersTable.userId, userId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  const [row] = await db
    .update(foldersTable)
    .set(patch)
    .where(eq(foldersTable.id, id))
    .returning();
  res.json(row);
});

// DELETE /api/folders/:id → remove the folder. Sessions inside the folder
// are NOT deleted — they're moved back to "root" (folderId = null).
router.delete("/folders/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const userId = req.user!.id;
  const [existing] = await db
    .select()
    .from(foldersTable)
    .where(and(eq(foldersTable.id, id), eq(foldersTable.userId, userId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  // Move all sessions in this folder back to root.
  await db
    .update(sessionsTable)
    .set({ folderId: null })
    .where(eq(sessionsTable.folderId, id));
  await db.delete(foldersTable).where(eq(foldersTable.id, id));
  res.status(204).end();
});

// POST /api/sessions/:id/move → put a session into a folder (or root with null)
router.post("/sessions/:id/move", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const folderId = parseFolderId(req.body?.folderId);
  if (folderId === undefined) {
    res.status(400).json({ error: "folderId must be a positive integer or null" });
    return;
  }
  const userId = req.user!.id;
  const isAdmin = req.user!.isAdmin;

  // Verify session ownership.
  const [sess] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .limit(1);
  if (!sess) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (!isAdmin && sess.userId !== userId) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Verify the target folder belongs to the same user (unless moving to root).
  if (folderId !== null) {
    const [folder] = await db
      .select()
      .from(foldersTable)
      .where(and(eq(foldersTable.id, folderId), eq(foldersTable.userId, userId)))
      .limit(1);
    if (!folder) {
      res.status(404).json({ error: "Target folder not found" });
      return;
    }
  }

  const [row] = await db
    .update(sessionsTable)
    .set({ folderId })
    .where(eq(sessionsTable.id, id))
    .returning();
  res.json(row);
});

export default router;
