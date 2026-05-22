import { useState, useRef, useCallback, useEffect } from "react";
import type { LiveTranscriptChunk, SpeakerLabel, SpeechRecognitionState } from "./use-speech-recognition";
import type { LanguageCode } from "./use-speech-recognition";

const SPEAKERS: SpeakerLabel[] = ["Speaker A", "Speaker B", "Speaker C"];
const CHUNK_INTERVAL_MS = 4000;

interface UseOpenAIWhisperOptions {
  sessionId: number;
  numSpeakers?: number;
  language?: LanguageCode;
  onFinalChunk?: (chunk: LiveTranscriptChunk) => void;
}

export interface OpenAIWhisperState extends SpeechRecognitionState {
  currentSpeaker: SpeakerLabel;
  nextSpeaker: () => void;
}

export function useOpenAIWhisperApi({
  sessionId,
  numSpeakers = 2,
  language = "de-DE",
  onFinalChunk,
}: UseOpenAIWhisperOptions): OpenAIWhisperState {
  const [isListening, setIsListening] = useState(false);
  const [permissionState, setPermissionState] = useState<"unknown" | "granted" | "denied" | "prompt">("unknown");
  const [liveChunk, setLiveChunk] = useState<LiveTranscriptChunk | null>(null);
  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerLabel>("Speaker A");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef<number>(Date.now());
  const currentSpeakerRef = useRef<SpeakerLabel>("Speaker A");
  const numSpeakersRef = useRef(numSpeakers);
  const languageRef = useRef(language);
  const onFinalChunkRef = useRef(onFinalChunk);
  const isListeningRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => { onFinalChunkRef.current = onFinalChunk; }, [onFinalChunk]);
  useEffect(() => { numSpeakersRef.current = numSpeakers; }, [numSpeakers]);
  useEffect(() => { languageRef.current = language; }, [language]);

  const isSupported =
    typeof window !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined";

  const sendChunk = useCallback(async (blob: Blob) => {
    if (!isListeningRef.current || blob.size < 1000) return;
    if (pendingRef.current) return;

    pendingRef.current = true;
    const speakerAtSend = currentSpeakerRef.current;
    const startMs = Date.now() - sessionStartRef.current;

    setLiveChunk({
      id: "transcribing",
      speakerLabel: speakerAtSend,
      text: "…",
      startMs,
      isFinal: false,
    });

    try {
      const form = new FormData();
      form.append("audio", blob, "audio.webm");
      form.append("language", languageRef.current);

      const res = await fetch(`/api/sessions/${sessionId}/transcribe`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { text } = (await res.json()) as { text: string };

      setLiveChunk(null);

      const trimmed = text?.trim();
      if (trimmed && isListeningRef.current) {
        const chunk: LiveTranscriptChunk = {
          id: `${Date.now()}-${Math.random()}`,
          speakerLabel: speakerAtSend,
          text: trimmed,
          startMs,
          isFinal: true,
        };
        onFinalChunkRef.current?.(chunk);
      }
    } catch (err) {
      console.error("OpenAI Whisper API error:", err);
      setLiveChunk(null);
    } finally {
      pendingRef.current = false;
    }
  }, [sessionId]);

  const flushChunks = useCallback(() => {
    if (!isListeningRef.current) return;
    const chunks = chunksRef.current.splice(0);
    if (!chunks.length) return;
    const mimeType = mediaRecorderRef.current?.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type: mimeType });
    sendChunk(blob);
  }, [sendChunk]);

  const nextSpeaker = useCallback(() => {
    const pool = SPEAKERS.slice(0, numSpeakersRef.current);
    const idx = pool.indexOf(currentSpeakerRef.current);
    const next = pool[(idx + 1) % pool.length] ?? pool[0]!;
    currentSpeakerRef.current = next;
    setCurrentSpeaker(next);
  }, []);

  const stop = useCallback(() => {
    isListeningRef.current = false;

    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    chunksRef.current = [];
    pendingRef.current = false;
    setIsListening(false);
    setLiveChunk(null);
  }, []);

  const start = useCallback(async () => {
    if (!isSupported) {
      setError("Audio capture is not supported in this browser.");
      return;
    }

    setError(null);
    sessionStartRef.current = Date.now();
    chunksRef.current = [];
    pendingRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      streamRef.current = stream;
      setPermissionState("granted");

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.start(500);
      isListeningRef.current = true;
      setIsListening(true);

      chunkIntervalRef.current = setInterval(flushChunks, CHUNK_INTERVAL_MS);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NotAllowedError") {
        setPermissionState("denied");
        setError("Microphone access denied. Please allow mic access in your browser settings.");
      } else {
        setError("Could not access microphone. Please try again.");
      }
    }
  }, [isSupported, flushChunks]);

  useEffect(() => () => { stop(); }, [stop]);

  return {
    isListening,
    isSupported,
    permissionState,
    liveChunk,
    currentSpeaker,
    error,
    start,
    stop,
    nextSpeaker,
  };
}
