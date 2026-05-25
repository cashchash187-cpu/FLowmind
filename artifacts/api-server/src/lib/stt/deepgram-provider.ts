import { WebSocket } from "ws";
import type { SttProvider, SttProviderOptions, SttSession } from "./provider";

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";
const KEEPALIVE_MS = 8_000;

/**
 * Normalize a UI-level language code into Deepgram's 2-letter form.
 *  - "de-DE" / "de-CH" → "de"
 *  - "en-US" → "en"
 *  - empty / unknown → default "de" (FlowMind primary language)
 *
 * Multilingual auto-detect was removed: Deepgram's `multi` model produced
 * noisy English-tinted German for our users; an explicit language always
 * gives better quality.
 */
function normalizeLang(input: string): string {
  if (!input) return "de";
  const lower = input.toLowerCase();
  return lower.split("-")[0]!.slice(0, 2);
}

/** Convert Deepgram's integer speaker (0,1,2,…) to A,B,C,… */
function speakerLabel(n: number): string {
  return String.fromCharCode("A".charCodeAt(0) + n);
}

interface WordEntry {
  word?: string;
  punctuated_word?: string;
  speaker?: number;
}

/** Group consecutive words into same-speaker runs.
 *  Example: words [(Hallo,0),(das,0),(ist,0),(ja,1),(interessant,1)]
 *           → [{speaker:"A", text:"Hallo das ist"}, {speaker:"B", text:"ja interessant"}]
 */
function splitWordsBySpeakerRuns(words: WordEntry[]): { speaker: string | null; text: string }[] {
  const runs: { speaker: string | null; text: string }[] = [];
  let curSpeaker: string | null | undefined = undefined; // undefined = first iter
  let curParts: string[] = [];

  const flush = () => {
    if (curParts.length === 0) return;
    const text = curParts.join(" ").replace(/\s+/g, " ").trim();
    if (text) runs.push({ speaker: curSpeaker ?? null, text });
    curParts = [];
  };

  for (const w of words) {
    const raw = (w.punctuated_word ?? w.word ?? "").trim();
    if (!raw) continue;
    const s = typeof w.speaker === "number" && !Number.isNaN(w.speaker)
      ? speakerLabel(w.speaker)
      : null;
    if (curSpeaker === undefined) {
      curSpeaker = s;
    } else if (s !== curSpeaker) {
      flush();
      curSpeaker = s;
    }
    curParts.push(raw);
  }
  flush();
  return runs;
}

export const deepgramProvider: SttProvider = {
  async open(opts: SttProviderOptions): Promise<SttSession> {
    const apiKey = process.env["DEEPGRAM_API_KEY"];
    if (!apiKey) throw new Error("DEEPGRAM_API_KEY not set");

    const lang = normalizeLang(opts.language);

    // Model selection: nova-3 is sharper and more multilingual, but its
    // diarization (speaker labels) is only reliable for English right now.
    // When the user explicitly turned diarization on we drop to nova-2,
    // which has well-tested speaker separation across en / de / es / fr.
    const model = opts.diarize ? "nova-2" : "nova-3";

    const params = new URLSearchParams({
      model,
      language: lang,
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      // Wave 17 tuning: shorter endpointing for snappier multi-speaker
      // exchanges. The speaker-change splitter below means we no longer
      // need long windows to "stitch a clean sentence" — same-speaker
      // sentences are still merged across fragments while cross-speaker
      // jumps now flush immediately. Net effect: lines appear faster AND
      // speakers stay separated.
      endpointing: "500",
      utterance_end_ms: "1000",
    });
    if (opts.diarize) {
      params.set("diarize", "true");
    }

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

    // ── Utterance buffer ──────────────────────────────────────────────────
    // Holds parts of the CURRENT utterance from a single speaker. When a
    // speaker change is detected (either inside one fragment via word-run
    // analysis or between fragments) we flush before switching.
    let utteranceParts: string[] = [];
    let utteranceSpeaker: string | null = null;
    let lastEmitted = "";

    // Backchannel buffer — tiny acknowledgements like "ja", "ok", "mhm" get
    // collapsed into the next "real" utterance from the same speaker. This
    // keeps the transcript readable when one speaker is mainly listening.
    const BACKCHANNEL_MAX_WORDS = 1;
    const BACKCHANNEL_MAX_CHARS = 4;
    const pendingBackchannel = new Map<string | null, string[]>(); // speaker → accumulated tokens

    function isBackchannel(text: string): boolean {
      const t = text.replace(/[.,!?…]+/g, "").trim();
      if (!t) return true;
      const words = t.split(/\s+/);
      return words.length <= BACKCHANNEL_MAX_WORDS && t.length <= BACKCHANNEL_MAX_CHARS;
    }

    function consumeBackchannel(speaker: string | null): string {
      const buf = pendingBackchannel.get(speaker);
      if (!buf || buf.length === 0) return "";
      pendingBackchannel.delete(speaker);
      return buf.join(" ") + " ";
    }

    function emitFinal(text: string, speaker: string | null) {
      const merged = text.replace(/\s+/g, " ").trim();
      if (!merged || merged === lastEmitted) return;
      if (opts.diarize && isBackchannel(merged)) {
        // Park it — gets prepended to the next real utterance from this speaker.
        const buf = pendingBackchannel.get(speaker) ?? [];
        buf.push(merged);
        // Cap so a single user repeatedly saying "ja" doesn't grow forever.
        if (buf.length > 4) buf.shift();
        pendingBackchannel.set(speaker, buf);
        return;
      }
      const prefix = opts.diarize ? consumeBackchannel(speaker) : "";
      const finalText = (prefix + merged).trim();
      lastEmitted = finalText;
      opts.onFinal(finalText, speaker);
    }

    function flushUtterance() {
      if (utteranceParts.length === 0) return;
      const merged = utteranceParts.join(" ").replace(/\s+/g, " ").trim();
      const speaker = utteranceSpeaker;
      utteranceParts = [];
      utteranceSpeaker = null;
      if (!merged) return;
      emitFinal(merged, speaker);
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
        const alt0 = alts?.[0];
        const text = (alt0?.["transcript"] as string | undefined)?.trim();
        const words = alt0?.["words"] as WordEntry[] | undefined;
        const isFinal = data["is_final"] === true;
        const speechFinal = data["speech_final"] === true;

        if (!text) {
          // Empty result with speech_final = end of utterance with nothing to flush
          if (speechFinal) flushUtterance();
          return;
        }

        if (isFinal) {
          if (opts.diarize && words && words.length) {
            // ── Speaker-change splitter ─────────────────────────────────
            // Each finalized fragment can contain words from MULTIPLE
            // speakers (e.g. speaker B interrupted mid-sentence). Group
            // the words into consecutive same-speaker runs and emit ONE
            // final per run, splitting at the boundary.
            const runs = splitWordsBySpeakerRuns(words);
            if (runs.length === 0) return;

            for (let i = 0; i < runs.length; i++) {
              const run = runs[i]!;
              const isLastRun = i === runs.length - 1;

              if (utteranceSpeaker === null) {
                // First fragment of this utterance — adopt run's speaker.
                utteranceSpeaker = run.speaker;
                utteranceParts.push(run.text);
              } else if (run.speaker === utteranceSpeaker) {
                // Same speaker continues — append.
                utteranceParts.push(run.text);
              } else {
                // Speaker changed — flush what we have, then start fresh.
                flushUtterance();
                utteranceSpeaker = run.speaker;
                utteranceParts.push(run.text);
              }

              // Mid-fragment speaker changes always close out the previous
              // run (we just did). For the LAST run in the fragment we
              // honour speech_final to decide whether to flush now.
              if (!isLastRun) {
                // Force-flush at every internal speaker boundary — the run
                // we just appended IS its own complete chunk from that
                // speaker for this fragment.
                flushUtterance();
              }
            }

            // Live caption: show what's confirmed so far for the current speaker.
            if (utteranceParts.length > 0) {
              opts.onPartial(utteranceParts.join(" "), utteranceSpeaker);
            }
            if (speechFinal) flushUtterance();
          } else {
            // Non-diarized path — keep the old behavior (merge fragments).
            utteranceParts.push(text);
            opts.onPartial(utteranceParts.join(" "), utteranceSpeaker);
            if (speechFinal) flushUtterance();
          }
        } else {
          // Interim fragment. Compute the dominant speaker so we can show
          // a live caption with the right speaker label.
          let fragSpeaker: string | null = utteranceSpeaker;
          if (opts.diarize && words && words.length) {
            const counts: Record<string, number> = {};
            for (const w of words) {
              if (typeof w.speaker !== "number") continue;
              const key = speakerLabel(w.speaker);
              counts[key] = (counts[key] ?? 0) + 1;
            }
            let topKey: string | null = null;
            let topCount = 0;
            for (const [k, c] of Object.entries(counts)) {
              if (c > topCount) { topCount = c; topKey = k; }
            }
            if (topKey) fragSpeaker = topKey;
          }

          // If the partial belongs to a NEW speaker mid-utterance, flush
          // what we had — the previous speaker is clearly done even if
          // Deepgram hasn't issued speech_final yet.
          if (opts.diarize && utteranceSpeaker !== null && fragSpeaker !== null && fragSpeaker !== utteranceSpeaker && utteranceParts.length > 0) {
            flushUtterance();
          }

          // Append interim text to confirmed parts for a stable live caption.
          const live = [...utteranceParts, text].join(" ");
          opts.onPartial(live, utteranceSpeaker ?? fragSpeaker);
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
