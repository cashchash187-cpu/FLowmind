import { WebSocket } from "ws";
import type { SttProvider, SttProviderOptions, SttSession } from "./provider";

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";
const KEEPALIVE_MS = 8_000;

/**
 * Normalize a UI-level language code into what Deepgram expects.
 *  - "auto" / "multi" / "" → "multi"  (with detect_language=true)
 *  - "de" / "de-DE" / "de-CH" → "de"
 *  - "en-US" → "en"
 *  - otherwise the first 2 characters
 */
function normalizeLang(input: string): string {
  if (!input) return "multi";
  const lower = input.toLowerCase();
  if (lower === "auto" || lower === "multi") return "multi";
  return lower.split("-")[0]!.slice(0, 2);
}

export const deepgramProvider: SttProvider = {
  async open(opts: SttProviderOptions): Promise<SttSession> {
    const apiKey = process.env["DEEPGRAM_API_KEY"];
    if (!apiKey) throw new Error("DEEPGRAM_API_KEY not set");

    const lang = normalizeLang(opts.language);
    const isAuto = lang === "multi";

    // nova-3 is Deepgram's current multilingual model — covers en/de/es/fr/
    // it/pt/nl/ja/hi/ru with proper code-switching. nova-2 multi is en+es
    // only, which is why this server used to silently force English for
    // German speakers.
    const params = new URLSearchParams({
      model: "nova-3",
      language: lang,
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      // Longer endpointing + utterance window = fewer "ghost" mid-sentence
      // finals and a more natural cadence (sentences instead of fragments).
      endpointing: "900",
      utterance_end_ms: "1500",
    });
    // detect_language only valid alongside language=multi
    if (isAuto) params.set("detect_language", "true");

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

    // Buffer of finalized fragments that belong to the SAME utterance.
    // Deepgram emits multiple `is_final=true` packets per utterance — one per
    // audio segment that won't be revised. The OLD behavior emitted each one
    // as a separate transcript line which duplicated speech in the DB. We now
    // hold them until either `speech_final=true` or an `UtteranceEnd` event
    // signals the natural end of the utterance.
    let utteranceParts: string[] = [];
    let lastEmitted = "";

    function flushUtterance() {
      if (utteranceParts.length === 0) return;
      const merged = utteranceParts.join(" ").replace(/\s+/g, " ").trim();
      utteranceParts = [];
      if (!merged || merged === lastEmitted) return;
      lastEmitted = merged;
      opts.onFinal(merged);
    }

    ws.on("message", (raw: Buffer) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const type = data["type"] as string | undefined;

      if (type === "Results") {
        const channel = data["channel"] as Record<string, unknown> | undefined;
        const alts = channel?.["alternatives"] as Array<Record<string, unknown>> | undefined;
        const text = (alts?.[0]?.["transcript"] as string | undefined)?.trim();
        const isFinal = data["is_final"] === true;
        const speechFinal = data["speech_final"] === true;

        if (!text) {
          // Empty result with speech_final = end of utterance with nothing to flush
          if (speechFinal) flushUtterance();
          return;
        }

        if (isFinal) {
          utteranceParts.push(text);
          // Show what's confirmed so far as the live caption.
          opts.onPartial(utteranceParts.join(" "));
          if (speechFinal) flushUtterance();
        } else {
          // Interim — append to confirmed parts so the user sees a stable prefix.
          const live = [...utteranceParts, text].join(" ");
          opts.onPartial(live);
        }
        return;
      }

      if (type === "UtteranceEnd") {
        // Deepgram emits this when its utterance_end_ms timer fires with no
        // speech_final yet. Treat it as the same boundary signal.
        flushUtterance();
        return;
      }

      if (type === "Error" && !closed) {
        const msg = (data["message"] as string | undefined) ?? "Deepgram error";
        opts.onError(new Error(msg));
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
        // Drain anything we were holding on to before tearing down.
        flushUtterance();
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
