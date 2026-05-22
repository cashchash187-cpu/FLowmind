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

export type SpeakerLabel = "Speaker A" | "Speaker B" | "Speaker C";

export interface LiveTranscriptChunk {
  id: string;
  speakerLabel: SpeakerLabel;
  text: string;
  startMs: number;
  isFinal: boolean;
}

export const LANGUAGE_OPTIONS = [
  { code: "auto", label: "Auto-detect" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-IN", label: "English (India)" },
  { code: "de-DE", label: "Deutsch" },
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

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition requires Chrome or Edge.");
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    if (languageRef.current !== "auto") {
      recognition.lang = languageRef.current;
    }
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
