import { Router, type IRouter } from "express";
import { eq, desc, count, sql, and } from "drizzle-orm";
import { db, sessionsTable, transcriptsTable } from "@workspace/db";
import {
  CreateSessionBody,
  UpdateSessionParams,
  UpdateSessionBody,
  DeleteSessionParams,
  GetSessionParams,
  EndSessionParams,
} from "@workspace/api-zod";
import { refreshUserProfileInBackground } from "../lib/user-profile";
import { distillSessionToMemory } from "../lib/meeting-distiller";

const router: IRouter = Router();

/** Returns the session only if it belongs to the requesting user (or admin). 404-safe. */
async function getOwnedSession(
  sessionId: number,
  userId: number,
  isAdmin: boolean
) {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session) return null;
  if (!isAdmin && session.userId !== userId) return null; // 404 to prevent enumeration
  return session;
}

// NOTE: /sessions/stats and /sessions/recent MUST come before /sessions/:id

router.get("/sessions/stats", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const isAdmin = req.user!.isAdmin;

  const whereClause = isAdmin
    ? undefined
    : eq(sessionsTable.userId, userId);

  const [totals] = await db
    .select({
      totalSessions: count(sessionsTable.id),
      activeSessions: sql<number>`count(*) filter (where ${sessionsTable.status} = 'active')`,
      totalMinutes: sql<number>`coalesce(sum(${sessionsTable.durationSeconds}) / 60, 0)`,
      totalAiRequests: sql<number>`coalesce(sum(${sessionsTable.transcriptCount}), 0)`,
    })
    .from(sessionsTable)
    .where(whereClause);

  const avgResult = await db
    .select({ avg: sql<number>`coalesce(avg(${sessionsTable.durationSeconds}) / 60, 0)` })
    .from(sessionsTable)
    .where(
      whereClause
        ? and(whereClause, eq(sessionsTable.status, "ended"))
        : eq(sessionsTable.status, "ended")
    );

  res.json({
    totalSessions: Number(totals.totalSessions),
    activeSessions: Number(totals.activeSessions),
    totalMinutes: Number(totals.totalMinutes),
    totalAiRequests: Number(totals.totalAiRequests),
    avgDurationMinutes: Number(avgResult[0]?.avg ?? 0),
    topSpeakers: ["Speaker A", "Speaker B", "Speaker C"],
  });
});

router.get("/sessions/recent", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const isAdmin = req.user!.isAdmin;

  const sessions = await db
    .select()
    .from(sessionsTable)
    .where(isAdmin ? undefined : eq(sessionsTable.userId, userId))
    .orderBy(desc(sessionsTable.updatedAt))
    .limit(10);

  const previews = await Promise.all(
    sessions.map(async (s) => {
      const [last] = await db
        .select({ text: transcriptsTable.text, speaker: transcriptsTable.speakerLabel })
        .from(transcriptsTable)
        .where(eq(transcriptsTable.sessionId, s.id))
        .orderBy(desc(transcriptsTable.startMs))
        .limit(1);

      return {
        id: s.id,
        title: s.title,
        status: s.status,
        mode: s.mode,
        durationSeconds: s.durationSeconds,
        transcriptCount: s.transcriptCount,
        lastLine: last ? `${last.speaker}: ${last.text}` : null,
        createdAt: s.createdAt,
      };
    })
  );

  res.json(previews);
});

router.get("/sessions", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const isAdmin = req.user!.isAdmin;

  const sessions = await db
    .select()
    .from(sessionsTable)
    .where(isAdmin ? undefined : eq(sessionsTable.userId, userId))
    .orderBy(desc(sessionsTable.updatedAt));

  res.json(sessions);
});

router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.user!.id;

  const [session] = await db
    .insert(sessionsTable)
    .values({
      title: parsed.data.title,
      mode: parsed.data.mode ?? "copilot",
      status: "active",
      userId,
    })
    .returning();

  if (session.mode === "insight") {
    const { startInsightTicker } = await import("../lib/insight-ticker");
    startInsightTicker(userId, session.id);
  }

  res.status(201).json(session);
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const session = await getOwnedSession(params.data.id, req.user!.id, req.user!.isAdmin);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(session);
});

router.patch("/sessions/:id", async (req, res): Promise<void> => {
  const params = UpdateSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await getOwnedSession(params.data.id, req.user!.id, req.user!.isAdmin);
  if (!existing) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const parsed = UpdateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [session] = await db
    .update(sessionsTable)
    .set(parsed.data)
    .where(eq(sessionsTable.id, params.data.id))
    .returning();

  res.json(session);
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await getOwnedSession(params.data.id, req.user!.id, req.user!.isAdmin);
  if (!existing) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await db.delete(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  res.sendStatus(204);
});

router.patch("/sessions/:id/end", async (req, res): Promise<void> => {
  const params = EndSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await getOwnedSession(params.data.id, req.user!.id, req.user!.isAdmin);
  if (!existing) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [session] = await db
    .update(sessionsTable)
    .set({ status: "ended", endedAt: new Date() })
    .where(eq(sessionsTable.id, params.data.id))
    .returning();

  // Wave 17: opportunistically refresh the user's persistent profile in
  // the background. The profile aggregates briefs from recent sessions so
  // every new ended session is a chance to incorporate fresh signal. The
  // helper handles its own throttling (3 new sessions OR 7 days), so this
  // is cheap when the cap isn't due, free otherwise.
  refreshUserProfileInBackground(req.user!.id);

  // Wave 21: Meeting→Memory bridge. Only on the FIRST transition to
  // "ended" (re-ending an already-ended session must not duplicate the
  // memory items). Fire-and-forget — distillation takes a few LLM calls
  // and the user shouldn't wait on it to leave the page.
  if (existing.status !== "ended" && session.userId != null) {
    void distillSessionToMemory(session.id, session.userId).catch(() => {});
  }

  res.json(session);
});

router.post("/sessions/:id/heartbeat", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const existing = await getOwnedSession(id, req.user!.id, req.user!.isAdmin);
  if (!existing) { res.status(404).json({ error: "Session not found" }); return; }

  const [session] = await db
    .update(sessionsTable)
    .set({ lastHeartbeatAt: new Date() })
    .where(eq(sessionsTable.id, id))
    .returning({ status: sessionsTable.status });

  res.json({ status: session.status });
});

router.post("/sessions/:id/resume", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const existing = await getOwnedSession(id, req.user!.id, req.user!.isAdmin);
  if (!existing) { res.status(404).json({ error: "Session not found" }); return; }

  const [session] = await db
    .update(sessionsTable)
    .set({ status: "active", lastHeartbeatAt: new Date() })
    .where(eq(sessionsTable.id, id))
    .returning();

  res.json(session);
});

export default router;
