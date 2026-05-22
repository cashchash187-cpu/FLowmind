import { useState, useEffect, useRef, useCallback } from "react";
import type { LiveTranscriptChunk, SpeakerLabel, SpeechRecognitionState } from "./use-speech-recognition";
import { type LanguageCode } from "./use-speech-recognition";

const SPEAKERS: SpeakerLabel[] = ["Speaker A", "Speaker B", "Speaker C"];

// How often to evaluate accumulated speech and send to Whisper (ms)
const CHUNK_INTERVAL_MS = 5000;

// ScriptProcessor buffer — 4096 ≈ 85ms at 48kHz, 93ms at 44.1kHz
const SCRIPT_BUFFER_SIZE = 4096;

// Whisper requires 16kHz mono Float32
const WHISPER_SAMPLE_RATE = 16000;

// RMS energy below this = silence, above = speech
// Typical quiet room noise ≈ 0.001–0.004; clear speech ≈ 0.01–0.1
const SPEECH_RMS_THRESHOLD = 0.008;

// Minimum accumulated speech (seconds at native rate) needed to send a chunk
const MIN_SPEECH_SECONDS = 0.8;

// Whisper hallucination patterns to discard
const HALLUCINATION_RE = /^(\s*[\.\,\!\?…]+\s*|thank you\.?|thanks\.?|you\.?|bye\.?|goodbye\.?|\.+)$/i;

function computeRMS(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / buf.length);
}

/**
 * Linear-interpolation resample from srcRate → WHISPER_SAMPLE_RATE.
 * Good enough quality for speech; avoids WebAudio context rate issues.
 */
function resampleTo16k(samples: Float32Array, srcRate: number): Float32Array {
  if (srcRate === WHISPER_SAMPLE_RATE) return samples;
  const ratio = srcRate / WHISPER_SAMPLE_RATE;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = pos - lo;
    out[i] = (samples[lo] ?? 0) * (1 - frac) + (samples[hi] ?? 0) * frac;
  }
  return out;
}

interface UseWhisperOptions {
  numSpeakers?: number;
  language?: LanguageCode;
  onFinalChunk?: (chunk: LiveTranscriptChunk) => void;
  /** Only start the worker / download the model when true. Defaults to false. */
  enabled?: boolean;
}

export interface WhisperState extends SpeechRecognitionState {
  isModelLoading: boolean;
  modelLoadProgress: number;
  currentSpeaker: SpeakerLabel;
  nextSpeaker: () => void;
}

export function useWhisperTranscription({
  numSpeakers = 2,
  language = "de-DE",
  onFinalChunk,
  enabled = false,
}: UseWhisperOptions = {}): WhisperState {
  const [isListening, setIsListening] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelLoadProgress, setModelLoadProgress] = useState(0);
  const [permissionState, setPermissionState] = useState<
    "unknown" | "granted" | "denied" | "prompt"
  >("unknown");
  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerLabel>("Speaker A");
  const [liveChunk, setLiveChunk] = useState<LiveTranscriptChunk | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Only speech frames (RMS above threshold) accumulate here
  const speechFramesRef = useRef<Float32Array[]>([]);
  // Native sample rate — set when AudioContext is created
  const nativeSampleRateRef = useRef<number>(48000);

  const sessionStartRef = useRef<number>(Date.now());
  const currentSpeakerRef = useRef<SpeakerLabel>("Speaker A");
  const numSpeakersRef = useRef(numSpeakers);
  const languageRef = useRef(language);
  const onFinalChunkRef = useRef(onFinalChunk);
  const isListeningRef = useRef(false);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelReadyRef = useRef(false);

  useEffect(() => { onFinalChunkRef.current = onFinalChunk; }, [onFinalChunk]);
  useEffect(() => { numSpeakersRef.current = numSpeakers; }, [numSpeakers]);
  useEffect(() => { languageRef.current = language; }, [language]);

  const isSupported =
    typeof window !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";

  // ── Worker lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isSupported || !enabled) return;

    const worker = new Worker(
      new URL("../workers/whisper.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as {
        type: string;
        progress?: number;
        text?: string;
        message?: string;
      };

      if (msg.type === "ready") {
        modelReadyRef.current = true;
        setIsModelLoading(false);
        setModelLoadProgress(100);
      } else if (msg.type === "loading") {
        setIsModelLoading(true);
        setModelLoadProgress(msg.progress ?? 0);
      } else if (msg.type === "result") {
        const raw = (msg.text ?? "").trim();
        setLiveChunk(null);
        // Discard Whisper hallucination artifacts
        if (raw && !HALLUCINATION_RE.test(raw) && isListeningRef.current) {
          const chunk: LiveTranscriptChunk = {
            id: `${Date.now()}-${Math.random()}`,
            speakerLabel: currentSpeakerRef.current,
            text: raw,
            startMs: Date.now() - sessionStartRef.current,
            isFinal: true,
          };
          onFinalChunkRef.current?.(chunk);
        }
      } else if (msg.type === "error") {
        setError(msg.message ?? "Whisper error");
        setIsModelLoading(false);
        setLiveChunk(null);
      }
    };

    workerRef.current = worker;
    setIsModelLoading(true);
    worker.postMessage({ type: "load" });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [isSupported, enabled]);

  // ── Send accumulated speech frames to Whisper ─────────────────────────────
  const sendChunkToWorker = useCallback(() => {
    if (!isListeningRef.current || !workerRef.current) return;

    const frames = speechFramesRef.current.splice(0);
    if (!frames.length) return;

    const totalNativeSamples = frames.reduce((a, b) => a + b.length, 0);
    const minSamples = nativeSampleRateRef.current * MIN_SPEECH_SECONDS;

    // Not enough speech detected in this window — skip silently
    if (totalNativeSamples < minSamples) return;

    // Concatenate all speech frames
    const combined = new Float32Array(totalNativeSamples);
    let off = 0;
    for (const f of frames) { combined.set(f, off); off += f.length; }

    // Resample to 16kHz for Whisper
    const resampled = resampleTo16k(combined, nativeSampleRateRef.current);

    setLiveChunk({
      id: "transcribing",
      speakerLabel: currentSpeakerRef.current,
      text: "…",
      startMs: Date.now() - sessionStartRef.current,
      isFinal: false,
    });

    workerRef.current.postMessage(
      { type: "transcribe", audio: resampled, language: languageRef.current },
      [resampled.buffer],
    );
  }, []);

  // ── Speaker switching ─────────────────────────────────────────────────────
  const nextSpeaker = useCallback(() => {
    const pool = SPEAKERS.slice(0, numSpeakersRef.current);
    const idx = pool.indexOf(currentSpeakerRef.current);
    const next = pool[(idx + 1) % pool.length] ?? pool[0];
    currentSpeakerRef.current = next!;
    setCurrentSpeaker(next!);
  }, []);

  // ── Stop ──────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    isListeningRef.current = false;

    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    speechFramesRef.current = [];
    setIsListening(false);
    setLiveChunk(null);
  }, []);

  // ── Start ─────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (!isSupported) {
      setError("Audio capture is not supported in this browser.");
      return;
    }

    setError(null);
    sessionStartRef.current = Date.now();
    speechFramesRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: { ideal: 16000 },
        },
        video: false,
      });
      streamRef.current = stream;
      setPermissionState("granted");

      // Create at NATIVE rate — avoids browser resampling artifacts.
      // We resample explicitly to 16kHz before sending to Whisper.
      const audioCtx = new AudioContext();
      nativeSampleRateRef.current = audioCtx.sampleRate;
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessorNode gives us raw Float32 access (deprecated but
      // universally supported; AudioWorklet requires a separate file).
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = audioCtx.createScriptProcessor(SCRIPT_BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      // Muted destination — processor must be connected to destination to fire,
      // but we don't want the mic to play back through speakers.
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      // VAD: only store frames where speech energy is above threshold
      processor.onaudioprocess = (e) => {
        if (!isListeningRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const rms = computeRMS(inputData);
        if (rms > SPEECH_RMS_THRESHOLD) {
          // Copy — the underlying buffer is reused by the browser
          speechFramesRef.current.push(new Float32Array(inputData));
        }
      };

      isListeningRef.current = true;
      setIsListening(true);

      chunkIntervalRef.current = setInterval(sendChunkToWorker, CHUNK_INTERVAL_MS);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NotAllowedError") {
        setPermissionState("denied");
        setError("Microphone access denied. Please allow mic access in your browser settings.");
      } else {
        setError("Could not access microphone. Please try again.");
      }
    }
  }, [isSupported, sendChunkToWorker]);

  useEffect(() => () => { stop(); }, [stop]);

  return {
    isListening,
    isModelLoading,
    modelLoadProgress,
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
