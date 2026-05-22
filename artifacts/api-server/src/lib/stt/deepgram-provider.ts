import { WebSocket } from "ws";
import type { SttProvider, SttProviderOptions, SttSession } from "./provider";

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";
const KEEPALIVE_MS = 8_000;

export const deepgramProvider: SttProvider = {
  async open(opts: SttProviderOptions): Promise<SttSession> {
    const apiKey = process.env["DEEPGRAM_API_KEY"];
    if (!apiKey) throw new Error("DEEPGRAM_API_KEY not set");

    const lang =
      opts.language === "auto" || opts.language === "multi"
        ? "multi"
        : opts.language.startsWith("de")
          ? "de"
          : opts.language;

    const params = new URLSearchParams({
      model: "nova-2",
      language: lang,
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: "400",
      utterance_end_ms: "1000",
    });

    const url = `${DEEPGRAM_WS_URL}?${params}`;
    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Deepgram connection timeout")), 10_000);

      ws.once("open", () => {
        clearTimeout(timeout);
        keepaliveTimer = setInterval(() => {
          if (!closed && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, KEEPALIVE_MS);
        resolve();
      });

      ws.once("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    ws.on("message", (raw: Buffer) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const type = data["type"] as string | undefined;
      if (type === "Results") {
        const channel = (data["channel"] as Record<string, unknown> | undefined);
        const alts = channel?.["alternatives"] as Array<Record<string, unknown>> | undefined;
        const text = (alts?.[0]?.["transcript"] as string | undefined)?.trim();
        if (!text) return;

        if (data["is_final"] === true) {
          opts.onFinal(text);
        } else {
          opts.onPartial(text);
        }
      } else if (type === "Error") {
        if (!closed) {
          const msg = (data["message"] as string | undefined) ?? "Deepgram error";
          opts.onError(new Error(msg));
        }
      }
    });

    ws.on("error", (err: Error) => {
      if (!closed) opts.onError(err);
    });

    ws.on("close", () => {
      closed = true;
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      opts.onClose();
    });

    return {
      sendAudio(chunk: Buffer) {
        if (!closed && ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        }
      },
      close() {
        if (closed) return;
        closed = true;
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        try {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        } catch { /* ignore */ }
        try {
          ws.close();
        } catch { /* ignore */ }
      },
    };
  },
};
