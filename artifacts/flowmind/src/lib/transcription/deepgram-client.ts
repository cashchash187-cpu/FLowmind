import { useAuthStore, getApiUrl } from "@/lib/auth";

export type DgMessage =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "limit"; reason: string; message: string }
  | { type: "error"; reason: string; message: string };

export type DgClientCallbacks = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onLimit: (msg: string) => void;
  onError: (msg: string) => void;
  onReady: () => void;
  onClose: () => void;
};

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000];

export class DeepgramStreamClient {
  private ws: WebSocket | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private closed = false;
  private reconnectAttempt = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private sessionId: number,
    private language: string,
    private callbacks: DgClientCallbacks
  ) {}

  async start(): Promise<void> {
    this.closed = false;
    this.reconnectAttempt = 0;
    await this.openMic();
    this.connect();
  }

  private async openMic(): Promise<void> {
    // Probe permission state first so we don't trigger the OS "mic granted"
    // banner unnecessarily on every restart (Android Chrome shows it every
    // time a getUserMedia call lands, even when permission is already
    // granted). When the state is already "granted" we still need a stream,
    // but at least the prompt doesn't show.
    try {
      if (navigator.permissions) {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (status.state === "denied") {
          const msg = "Microphone access is blocked. Open the address-bar lock icon to allow it, then try again.";
          this.callbacks.onError(msg);
          throw new Error(msg);
        }
      }
    } catch {
      // Permissions API not supported on this browser — fall through to direct getUserMedia.
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      const msg = err instanceof Error && err.name === "NotAllowedError"
        ? "Microphone access denied. Please allow mic access in your browser settings."
        : "Could not access microphone. Please check your device settings.";
      this.callbacks.onError(msg);
      throw new Error(msg);
    }
  }

  private connect() {
    if (this.closed) return;

    const token = useAuthStore.getState().token;
    if (!token) { this.callbacks.onError("Not authenticated."); return; }

    // Build WS URL — use window.location so we always get an absolute URL
    // with the correct protocol (wss: on HTTPS, ws: on plain HTTP).
    // The /api/ws/transcribe path goes through the shared reverse proxy.
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${wsProto}//${window.location.host}/api/ws/transcribe?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.callbacks.onError("Failed to open WebSocket.");
      return;
    }

    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.ws!.send(JSON.stringify({
        type: "init",
        sessionId: this.sessionId,
        language: this.language,
      }));
    };

    this.ws.onmessage = (ev) => {
      let msg: DgMessage;
      try { msg = JSON.parse(ev.data as string); } catch { return; }

      switch (msg.type) {
        case "ready":
          this.startRecorder();
          this.callbacks.onReady();
          break;
        case "partial":
          this.callbacks.onPartial(msg.text);
          break;
        case "final":
          this.callbacks.onFinal(msg.text);
          break;
        case "limit":
          this.callbacks.onLimit(msg.message);
          this.stop();
          break;
        case "error":
          if (msg.reason === "plan") {
            // Signal to fall back to browser engine
            this.callbacks.onError("__plan_fallback__");
            this.stop();
          } else {
            this.callbacks.onError(msg.message);
          }
          break;
      }
    };

    this.ws.onclose = (ev) => {
      this.stopRecorder();
      if (this.closed) {
        this.callbacks.onClose();
        return;
      }
      // Auto-reconnect with backoff (unless plan/limit/auth close)
      if (ev.code === 4001 || ev.code === 4003 || ev.code === 4004) {
        this.callbacks.onClose();
        return;
      }
      const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
      this.reconnectAttempt++;
      this.callbacks.onError(`Connection dropped — reconnecting in ${delay / 1000}s…`);
      setTimeout(() => { if (!this.closed) this.connect(); }, delay);
    };

    this.ws.onerror = () => {
      // onclose will fire next; let it handle reconnect
    };
  }

  private startRecorder() {
    if (!this.stream) return;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 32000,
      });
    } catch {
      this.callbacks.onError("MediaRecorder not supported in this browser.");
      return;
    }

    this.mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0 && this.ws?.readyState === WebSocket.OPEN) {
        ev.data.arrayBuffer().then((buf) => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(buf);
          }
        });
      }
    };

    this.mediaRecorder.start(100); // 100ms chunks
  }

  private stopRecorder() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try { this.mediaRecorder.stop(); } catch { /* ignore */ }
    }
    this.mediaRecorder = null;
  }

  stop() {
    this.closed = true;
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
    this.stopRecorder();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }

  get isActive() {
    return !this.closed && this.ws !== null;
  }
}
