export interface SttSession {
  sendAudio(chunk: Buffer): void;
  close(): void;
}

export interface SttProviderOptions {
  language: string;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

export interface SttProvider {
  open(opts: SttProviderOptions): Promise<SttSession>;
}
