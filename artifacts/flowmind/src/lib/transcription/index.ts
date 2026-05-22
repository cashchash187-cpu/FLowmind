import { useState, useRef, useCallback, useEffect } from "react";
import { useAuthStore } from "@/lib/auth";
import {
  useSpeechRecognition,
  type LiveTranscriptChunk,
  type LanguageCode,
} from "@/hooks/use-speech-recognition";
import { DeepgramStreamClient } from "./deepgram-client";

export type TranscriptionEngine = "browser" | "deepgram";

export interface TranscriptionState {
  isListening: boolean;
  isConnecting: boolean;
  isSupported: boolean;
  permissionState: "unknown" | "granted" | "denied" | "prompt";
  livePartial: string | null;
  error: string | null;
  engine: TranscriptionEngine;
  start: () => void;
  stop: () => void;
}

interface UseTranscriptionOptions {
  sessionId: number;
  language: LanguageCode;
  onFinalChunk: (chunk: LiveTranscriptChunk) => void;
  sessionBaseTime?: number;
  /** Pro users can manually override to "browser" to force the cheaper engine */
  forceEngine?: "browser" | "deepgram";
}

const PRO_PLANS = new Set(["pro", "business", "admin"]);

export function useTranscription({
  sessionId,
  language,
  onFinalChunk,
  sessionBaseTime,
  forceEngine,
}: UseTranscriptionOptions): TranscriptionState {
  const { user } = useAuthStore();
  const usePro = PRO_PLANS.has(user?.plan ?? "") || !!user?.isAdmin;

  // Always mount the browser engine (Free path + fallback)
  // Rules of Hooks: this must always be called regardless of plan
  const browserSpeech = useSpeechRecognition({
    language,
    onFinalChunk,
    sessionBaseTime,
  });

  // Deepgram state (Pro path) — always declared, only used when usePro
  const [dgConnecting, setDgConnecting] = useState(false);
  const [dgListening, setDgListening] = useState(false);
  const [dgPartial, setDgPartial] = useState<string | null>(null);
  const [dgError, setDgError] = useState<string | null>(null);
  const [dgFallback, setDgFallback] = useState(false);
  const dgClientRef = useRef<DeepgramStreamClient | null>(null);
  const sessionBaseTimeRef = useRef(sessionBaseTime);

  useEffect(() => {
    sessionBaseTimeRef.current = sessionBaseTime;
  }, [sessionBaseTime]);

  // Stable ref to the browser speech start so dgStart callback doesn't need
  // browserSpeech in its dependency array (avoids stale closure issues)
  const browserStartRef = useRef(browserSpeech.start);
  useEffect(() => {
    browserStartRef.current = browserSpeech.start;
  });

  const dgStart = useCallback(async () => {
    setDgError(null);
    setDgPartial(null);
    setDgConnecting(true);
    const client = new DeepgramStreamClient(sessionId, language, {
      onReady: () => {
        setDgConnecting(false);
        setDgListening(true);
      },
      onPartial: (text) => setDgPartial(text),
      onFinal: (text) => {
        setDgPartial(null);
        const chunk: LiveTranscriptChunk = {
          id: `dg-${Date.now()}-${Math.random()}`,
          speakerLabel: "Speaker A",
          text,
          startMs: Date.now() - (sessionBaseTimeRef.current ?? Date.now()),
          isFinal: true,
        };
        onFinalChunk(chunk);
      },
      onLimit: (msg) => {
        setDgConnecting(false);
        setDgListening(false);
        setDgError(msg);
      },
      onError: (msg) => {
        setDgConnecting(false);
        if (msg === "__plan_fallback__") {
          setDgFallback(true);
          setDgListening(false);
          browserStartRef.current();
        } else {
          setDgError(msg);
        }
      },
      onClose: () => {
        setDgConnecting(false);
        setDgListening(false);
        setDgPartial(null);
      },
    });
    dgClientRef.current = client;
    try {
      await client.start();
    } catch {
      setDgConnecting(false);
      setDgListening(false);
    }
  }, [sessionId, language, onFinalChunk]);

  const dgStop = useCallback(() => {
    dgClientRef.current?.stop();
    dgClientRef.current = null;
    setDgListening(false);
    setDgPartial(null);
  }, []);

  useEffect(() => {
    return () => {
      dgClientRef.current?.stop();
    };
  }, []);

  // ── Route by plan + manual override — computed AFTER all hooks ───────────
  // forceEngine="browser" lets Pro users fall back to browser STT manually
  const useDeepgram = usePro && !dgFallback && forceEngine !== "browser";

  if (!useDeepgram) {
    return {
      isListening: browserSpeech.isListening,
      isConnecting: false,
      isSupported: browserSpeech.isSupported,
      permissionState: browserSpeech.permissionState,
      livePartial: browserSpeech.liveChunk?.text ?? null,
      error: browserSpeech.error,
      engine: "browser",
      start: browserSpeech.start,
      stop: browserSpeech.stop,
    };
  }

  return {
    isListening: dgListening,
    isConnecting: dgConnecting,
    isSupported: true,
    permissionState: dgListening ? "granted" : "unknown",
    livePartial: dgPartial,
    error: dgError,
    engine: "deepgram",
    start: dgStart,
    stop: dgStop,
  };
}
