import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, meetingNotesTable, sessionsTable } from "@workspace/db";
import {
  GetSessionNotesParams,
  UpsertSessionNotesParams,
  UpsertSessionNotesBody,
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

router.get("/sessions/:id/notes", async (req, res): Promise<void> => {
  const params = GetSessionNotesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const owned = await getOwnedSession(params.data.id, req.user!.id, req.user!.isAdmin);
  if (!owned) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [notes] = await db
    .select()
    .from(meetingNotesTable)
    .where(eq(meetingNotesTable.sessionId, params.data.id));

  if (!notes) {
    res.status(404).json({ error: "Notes not found for this session" });
    return;
  }

  res.json(notes);
});

router.put("/sessions/:id/notes", async (req, res): Promise<void> => {
  const params = UpsertSessionNotesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const owned = await getOwnedSession(params.data.id, req.user!.id, req.user!.isAdmin);
  if (!owned) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const parsed = UpsertSessionNotesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(meetingNotesTable)
    .where(eq(meetingNotesTable.sessionId, params.data.id));

  let notes;
  if (existing) {
    [notes] = await db
      .update(meetingNotesTable)
      .set({
        summary: parsed.data.summary ?? existing.summary,
        actionItems: parsed.data.actionItems ?? existing.actionItems,
        decisions: parsed.data.decisions ?? existing.decisions,
        openQuestions: parsed.data.openQuestions ?? existing.openQuestions,
        keyInsights: parsed.data.keyInsights ?? existing.keyInsights,
      })
      .where(eq(meetingNotesTable.sessionId, params.data.id))
      .returning();
  } else {
    [notes] = await db
      .insert(meetingNotesTable)
      .values({
        sessionId: params.data.id,
        summary: parsed.data.summary ?? "",
        actionItems: parsed.data.actionItems ?? [],
        decisions: parsed.data.decisions ?? [],
        openQuestions: parsed.data.openQuestions ?? [],
        keyInsights: parsed.data.keyInsights ?? [],
      })
      .returning();
  }

  res.json(notes);
});

export default router;
