import { useState, useEffect, useRef, useCallback } from "react";

// ── Web Speech API minimal type shims ────────────────────────────────────────
// The standard lib.dom.d.ts doesn't include SpeechRecognition in all TS versions.
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}
interface SpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventShim extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventShim extends Event {
  readonly error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventShim) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventShim) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return (
    ((window as unknown as Record<string, unknown>).SpeechRecognition as SpeechRecognitionCtor | undefined) ??
    ((window as unknown as Record<string, unknown>).webkitSpeechRecognition as SpeechRecognitionCtor | undefined) ??
    null
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

// Used to be a fixed enum ("Speaker A" | "Speaker B" | "Speaker C") but we
// also need to express "no speaker info" (e.g. when diarization is off,
// label is just "Speaker") and Deepgram-supplied labels can go beyond C.
// String is the simplest correct type.
export type SpeakerLabel = string;

export interface LiveTranscriptChunk {
  id: string;
  speakerLabel: SpeakerLabel;
  text: string;
  startMs: number;
  isFinal: boolean;
}

// Auto-detect was removed intentionally — both engines were unreliable when
// no explicit language was set; Deepgram's "multi" model muddled German with
// English fragments, and browser STT fell back to system default which often
// guessed wrong. Pick a concrete language.
export const LANGUAGE_OPTIONS = [
  { code: "de-DE", label: "Deutsch" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-IN", label: "English (India)" },
  { code: "fr-FR", label: "Français" },
  { code: "es-ES", label: "Español" },
  { code: "it-IT", label: "Italiano" },
  { code: "pt-BR", label: "Português (BR)" },
  { code: "ja-JP", label: "日本語" },
  { code: "zh-CN", label: "中文" },
] as const;

export type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]["code"];

export const STORAGE_KEY_LANG = "fm_stt_lang";

interface UseSpeechRecognitionOptions {
  language?: LanguageCode;
  onFinalChunk?: (chunk: LiveTranscriptChunk) => void;
  sessionBaseTime?: number;
}

export interface SpeechRecognitionState {
  isListening: boolean;
  isSupported: boolean;
  permissionState: "unknown" | "granted" | "denied" | "prompt";
  liveChunk: LiveTranscriptChunk | null;
  error: string | null;
  start: () => void;
  stop: () => void;
}

const WATCHDOG_MS = 6_000; // Restart if no speech activity for 6s

export function useSpeechRecognition({
  language = "de-DE",
  onFinalChunk,
  sessionBaseTime,
}: UseSpeechRecognitionOptions = {}): SpeechRecognitionState {
  const [isListening, setIsListening] = useState(false);
  const [permissionState, setPermissionState] = useState<"unknown" | "granted" | "denied" | "prompt">("unknown");
  const [liveChunk, setLiveChunk] = useState<LiveTranscriptChunk | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const sessionStartRef = useRef<number>(sessionBaseTime ?? Date.now());
  const sessionBaseTimeRef = useRef(sessionBaseTime);
  const onFinalChunkRef = useRef(onFinalChunk);
  const languageRef = useRef(language);
  const shouldRestartRef = useRef(false);
  const lastFinalTextRef = useRef<string>("");
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stays true once we've confirmed mic access during this app session, so
  // the watchdog-driven restarts every 6s don't re-pop the iOS "mic granted"
  // toast on every restart. Reset only when the page reloads.
  const micGrantedRef = useRef(false);

  useEffect(() => { onFinalChunkRef.current = onFinalChunk; }, [onFinalChunk]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => {
    if (sessionBaseTime !== undefined) {
      sessionBaseTimeRef.current = sessionBaseTime;
      sessionStartRef.current = sessionBaseTime;
    }
  }, [sessionBaseTime]);

  const isSupported = !!getSpeechRecognitionCtor();

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const startRecognition = useCallback(async () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Browser transcription requires Chrome, Edge or another Chromium-based browser.");
      return;
    }

    // Skip every permission probe once we've already confirmed mic access in
    // this app session. Without this, the watchdog's silent restarts every
    // ~6s re-fired getUserMedia, which on iOS Chrome shows a fresh "mic
    // granted" toast every single time.
    if (!micGrantedRef.current) {
      let permState: PermissionState | "unsupported" = "unsupported";
      try {
        if (navigator.permissions) {
          const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
          permState = status.state;
          setPermissionState(status.state as typeof permissionState);
        }
      } catch {
        // Some browsers (Safari/iOS Chrome) don't expose "microphone" via
        // the Permissions API — we fall through and let SpeechRecognition
        // handle the prompt itself instead of triggering an extra
        // getUserMedia toast.
      }

      if (permState === "denied") {
        setError("Microphone access is blocked. Open the address-bar lock icon to allow it, then try again.");
        shouldRestartRef.current = false;
        return;
      }

      if (permState === "granted") {
        // Already granted — no prompt, no extra getUserMedia.
        micGrantedRef.current = true;
      } else if (permState === "prompt") {
        // Trigger the OS prompt ONCE by opening + immediately closing a
        // stream. SpeechRecognition.start() will open its own pipeline.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          setPermissionState("granted");
          micGrantedRef.current = true;
        } catch (err: unknown) {
          const name = err instanceof Error ? err.name : "";
          if (name === "NotAllowedError" || name === "SecurityError") {
            setPermissionState("denied");
            setError("Microphone access denied. Click the lock icon in your address bar to allow it, then try again.");
          } else if (name === "NotFoundError" || name === "OverconstrainedError") {
            setError("No microphone detected. Plug one in or pick a different input device.");
          } else {
            setError(`Could not access microphone${err instanceof Error ? `: ${err.message}` : ""}.`);
          }
          shouldRestartRef.current = false;
          return;
        }
      }
      // "unsupported" (iOS Safari, iOS Chrome): fall through. Let
      // SpeechRecognition handle the prompt — no preflight getUserMedia.
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = languageRef.current;
    recognition.maxAlternatives = 1;

    // Watchdog: restart if no speech for WATCHDOG_MS
    const resetWatchdog = () => {
      clearWatchdog();
      watchdogRef.current = setTimeout(() => {
        if (shouldRestartRef.current && recognitionRef.current === recognition) {
          try { recognition.stop(); } catch { /* onend handles restart */ }
        }
      }, WATCHDOG_MS);
    };

    recognition.onstart = () => {
      setIsListening(true);
      setPermissionState("granted");
      // If SpeechRecognition opens successfully the OS must have granted
      // mic access, so we can short-circuit all future permission probes.
      micGrantedRef.current = true;
      setError(null);
      resetWatchdog();
    };

    recognition.onspeechstart = () => {
      resetWatchdog();
    };

    recognition.onresult = (event: SpeechRecognitionEventShim) => {
      resetWatchdog();

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();
        if (!transcript) continue;

        const startMs = Date.now() - sessionStartRef.current;

        if (result.isFinal) {
          if (transcript === lastFinalTextRef.current) continue;
          lastFinalTextRef.current = transcript;

          const chunk: LiveTranscriptChunk = {
            id: `${Date.now()}-${Math.random()}`,
            speakerLabel: "Speaker A",
            text: transcript,
            startMs,
            isFinal: true,
          };
          setLiveChunk(null);
          onFinalChunkRef.current?.(chunk);
        } else {
          setLiveChunk({
            id: "live",
            speakerLabel: "Speaker A",
            text: transcript,
            startMs,
            isFinal: false,
          });
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventShim) => {
      if (event.error === "not-allowed" || event.error === "permission-denied") {
        setPermissionState("denied");
        shouldRestartRef.current = false;
        clearWatchdog();
        setError("Microphone access denied. Please allow mic access in your browser settings.");
      } else if (
        event.error === "no-speech" ||
        event.error === "audio-capture" ||
        event.error === "aborted" ||
        event.error === "network"
      ) {
        // Transient or intentional — onend will restart if shouldRestartRef is true
      } else {
        setError(`Recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      clearWatchdog();
      setLiveChunk(null);

      if (shouldRestartRef.current && recognitionRef.current === recognition) {
        setTimeout(() => {
          if (shouldRestartRef.current) {
            try {
              recognition.start();
            } catch {
              if (shouldRestartRef.current) startRecognition();
            }
          }
        }, 80);
      } else {
        setIsListening(false);
        recognitionRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setError("Could not start microphone. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearWatchdog]);

  const start = useCallback(() => {
    sessionStartRef.current = sessionBaseTimeRef.current ?? Date.now();
    lastFinalTextRef.current = "";
    shouldRestartRef.current = true;
    startRecognition();
  }, [startRecognition]);

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    clearWatchdog();
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setLiveChunk(null);
  }, [clearWatchdog]);

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      clearWatchdog();
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    };
  }, [clearWatchdog]);

  return { isListening, isSupported, permissionState, liveChunk, error, start, stop };
}
