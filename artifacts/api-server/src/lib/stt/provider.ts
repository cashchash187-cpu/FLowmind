export interface SttSession {
  sendAudio(chunk: Buffer): void;
  close(): void;
}

export interface SttProviderOptions {
  language: string;
  /** When true the provider enables speaker diarization and supplies a
      speaker tag with each partial / final. */
  diarize?: boolean;
  onPartial: (text: string, speaker?: string | null) => void;
  onFinal: (text: string, speaker?: string | null) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

export interface SttProvider {
  open(opts: SttProviderOptions): Promise<SttSession>;
}
