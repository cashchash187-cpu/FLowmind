import { Router, type IRouter } from "express";
import { eq, asc, count } from "drizzle-orm";
import { db, transcriptsTable, sessionsTable } from "@workspace/db";
import {
  AddTranscriptParams,
  AddTranscriptBody,
  ListTranscriptsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getOwnedSession(sessionId: number, userId: number, isAdmin: boolean) {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session) return null;
  if (!isAdmin && session.userId !== userId) return null;
  return session;
}

router.get("/sessions/:id/transcripts", async (req, res): Promise<void> => {
  const params = ListTranscriptsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const owned = await getOwnedSession(params.data.id, req.user!.id, req.user!.isAdmin);
  if (!owned) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const entries = await db
    .select()
    .from(transcriptsTable)
    .where(eq(transcriptsTable.sessionId, params.data.id))
    .orderBy(asc(transcriptsTable.startMs));

  res.json(entries);
});

router.post("/sessions/:id/transcripts", async (req, res): Promise<void> => {
  const params = AddTranscriptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const owned = await getOwnedSession(params.data.id, req.user!.id, req.user!.isAdmin);
  if (!owned) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const parsed = AddTranscriptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [entry] = await db
    .insert(transcriptsTable)
    .values({ ...parsed.data, sessionId: params.data.id })
    .returning();

  // Update denormalised transcript count on the session
  const [{ c }] = await db
    .select({ c: count() })
    .from(transcriptsTable)
    .where(eq(transcriptsTable.sessionId, params.data.id));

  await db
    .update(sessionsTable)
    .set({ transcriptCount: Number(c ?? 0) })
    .where(eq(sessionsTable.id, params.data.id));

  res.status(201).json(entry);
});

export default router;
