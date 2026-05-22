import type { IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { verifyToken } from "../lib/jwt";
import { db, usersTable, userSessionsTable, sessionsTable, transcriptsTable, usageTable } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { activeProvider } from "../lib/stt";
import { logger } from "../lib/logger";
import { getOrCreateUsage } from "../lib/usage-helpers";

const PRO_PLANS = new Set(["pro", "business", "admin"]);
const USAGE_SYNC_INTERVAL_MS = 10_000;

interface WsMsg {
  type: "init" | "audio";
  sessionId?: number;
  language?: string;
}

export function attachWsTranscribe(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    if (url.pathname !== "/api/ws/transcribe") return;
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const token =
      url.searchParams.get("token") ??
      (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");

    if (!token) {
      ws.close(4001, "Unauthorized");
      return;
    }

    let payload: { sub: number; jti: string };
    try {
      payload = verifyToken(token) as { sub: number; jti: string };
    } catch {
      ws.close(4001, "Invalid token");
      return;
    }

    const [sessionRow] = await db.select().from(userSessionsTable)
      .where(and(eq(userSessionsTable.jti, payload.jti), isNull(userSessionsTable.revokedAt)))
      .limit(1);
    if (!sessionRow) { ws.close(4001, "Session revoked"); return; }

    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.id, payload.sub)).limit(1);
    if (!user) { ws.close(4001, "User not found"); return; }

    // ── Plan gate ─────────────────────────────────────────────────────────────
    if (!PRO_PLANS.has(user.plan) && !user.isAdmin) {
      ws.send(JSON.stringify({ type: "error", reason: "plan", message: "Upgrade to Pro for AI transcription." }));
      ws.close(4003, "Plan required");
      return;
    }

    // ── Wait for init message with sessionId ──────────────────────────────────
    let sttSession: Awaited<ReturnType<typeof activeProvider.open>> | null = null;
    let sessionId: number | null = null;
    let language = "de";
    let audioSeconds = 0;
    let sessionBaseTime = Date.now();
    let usageSyncTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    function closeAll(code?: number, reason?: string) {
      if (closed) return;
      closed = true;
      if (usageSyncTimer) clearInterval(usageSyncTimer);
      sttSession?.close();
      if (ws.readyState === WebSocket.OPEN) {
        if (code) ws.close(code, reason);
        else ws.close();
      }
    }

    async function flushAudioUsage() {
      if (!sessionId || audioSeconds === 0 || user.isAdmin) return;
      const secs = audioSeconds;
      audioSeconds = 0;
      try {
        const usage = await getOrCreateUsage(user.id, user.plan);
        await db.update(usageTable)
          .set({ audioMinutesUsed: sql`${usageTable.audioMinutesUsed} + ${Math.ceil(secs / 60)}` })
          .where(eq(usageTable.id, usage.id));
      } catch (err) {
        logger.error({ err }, "[WS] Failed to flush audio usage");
      }
    }

    ws.on("message", async (data) => {
      if (closed) return;

      if (typeof data === "string") {
        let msg: WsMsg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === "init" && msg.sessionId) {
          sessionId = msg.sessionId;
          language = msg.language ?? "de";

          // Verify session ownership
          const [sess] = await db.select().from(sessionsTable)
            .where(eq(sessionsTable.id, sessionId)).limit(1);
          if (!sess || (sess.userId !== user.id && !user.isAdmin)) {
            ws.send(JSON.stringify({ type: "error", reason: "session", message: "Session not found." }));
            closeAll(4004, "Session not found");
            return;
          }
          sessionBaseTime = sess.createdAt ? new Date(sess.createdAt).getTime() : Date.now();

          // Check audio quota before opening stream
          if (!user.isAdmin) {
            const usage = await getOrCreateUsage(user.id, user.plan);
            if (usage.audioMinutesLimit !== -1 && usage.audioMinutesUsed >= usage.audioMinutesLimit) {
              ws.send(JSON.stringify({ type: "limit", reason: "audio", message: "Audio minutes quota reached." }));
              closeAll();
              return;
            }
          }

          // Flush usage every 10s
          usageSyncTimer = setInterval(async () => {
            await flushAudioUsage();
            // Re-check quota
            if (!user.isAdmin && sessionId) {
              const usage = await getOrCreateUsage(user.id, user.plan);
              if (usage.audioMinutesLimit !== -1 && usage.audioMinutesUsed >= usage.audioMinutesLimit) {
                ws.send(JSON.stringify({ type: "limit", reason: "audio", message: "Audio minutes quota reached." }));
                closeAll();
              }
            }
          }, USAGE_SYNC_INTERVAL_MS);

          try {
            sttSession = await activeProvider.open({
              language,
              onPartial: (text) => {
                if (!closed) ws.send(JSON.stringify({ type: "partial", text }));
              },
              onFinal: async (text) => {
                if (closed || !sessionId) return;
                ws.send(JSON.stringify({ type: "final", text }));
                // Persist transcript
                try {
                  await db.insert(transcriptsTable).values({
                    sessionId,
                    speakerLabel: "Speaker A",
                    text,
                    startMs: Date.now() - sessionBaseTime,
                  });
                } catch (err) {
                  logger.error({ err }, "[WS] Failed to persist transcript");
                }
              },
              onError: (err) => {
                logger.error({ err }, "[WS] STT error");
                if (!closed) ws.send(JSON.stringify({ type: "error", reason: "stt", message: err.message }));
              },
              onClose: () => closeAll(),
            });
            ws.send(JSON.stringify({ type: "ready" }));
          } catch (err) {
            logger.error({ err }, "[WS] Failed to open STT session");
            ws.send(JSON.stringify({ type: "error", reason: "stt", message: "Failed to connect to transcription service." }));
            closeAll();
          }
        }
        return;
      }

      // Binary audio frame
      if (sttSession && Buffer.isBuffer(data)) {
        sttSession.sendAudio(data);
        // ~1 frame = ~100ms of audio (20ms chunks from MediaRecorder)
        audioSeconds += 0.1;
      } else if (sttSession && data instanceof Buffer) {
        sttSession.sendAudio(data);
        audioSeconds += 0.1;
      } else if (sttSession) {
        const buf = Buffer.from(data as ArrayBuffer);
        sttSession.sendAudio(buf);
        audioSeconds += 0.1;
      }
    });

    ws.on("close", async () => {
      await flushAudioUsage();
      closeAll();
    });

    ws.on("error", (err) => {
      logger.error({ err }, "[WS] WebSocket error");
      closeAll();
    });
  });

  logger.info("WebSocket /ws/transcribe attached");
}
