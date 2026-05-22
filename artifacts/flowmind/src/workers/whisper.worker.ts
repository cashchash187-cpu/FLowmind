import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

type WorkerIncoming =
  | { type: "load"; language?: string }
  | { type: "transcribe"; audio: Float32Array; language: string };

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadPromise: Promise<void> | null = null;

function loadModel(): Promise<void> {
  if (asr) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", {
    dtype: {
      encoder_model: "q8",
      decoder_model_merged: "fp32",
    },
    progress_callback: (p: unknown) => {
      const progress = p as { status?: string; progress?: number };
      if (progress.status === "progress" && progress.progress != null) {
        self.postMessage({ type: "loading", progress: Math.round(progress.progress) });
      }
    },
  }).then((pipe) => {
    asr = pipe as AutomaticSpeechRecognitionPipeline;
  }).catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

self.onmessage = async (event: MessageEvent<WorkerIncoming>) => {
  const msg = event.data;

  if (msg.type === "load") {
    try {
      await loadModel();
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
    return;
  }

  if (msg.type === "transcribe") {
    try {
      if (!asr) {
        await loadModel();
        self.postMessage({ type: "ready" });
      }

      const isAuto = msg.language === "auto";
      const lang = isAuto ? undefined : msg.language.split("-")[0];

      const result = await asr!(msg.audio, {
        ...(lang ? { language: lang } : {}),
        task: "transcribe",
      });

      const text = Array.isArray(result)
        ? (result[0] as { text?: string })?.text ?? ""
        : (result as { text?: string })?.text ?? "";

      self.postMessage({ type: "result", text: text.trim() });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
};
