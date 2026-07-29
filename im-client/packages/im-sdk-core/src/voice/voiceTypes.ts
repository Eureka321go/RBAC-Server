import type { PickedMedia } from '../ports/index';

export type VoicePermissionStatus = 'unavailable' | 'denied' | 'blocked' | 'granted';

export interface VoiceRecordingProgress {
  durationMs: number;
  meteringDb: number | null;
}

export interface RecordedVoice extends PickedMedia {
  durationMs: number;
}

export interface VoicePermissionPort {
  check(): Promise<VoicePermissionStatus>;
  request(): Promise<VoicePermissionStatus>;
  openSettings(): Promise<void>;
}

export interface VoiceAudioSessionPort {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  onPauseRequested(handler: () => void): () => void;
  dispose(): Promise<void>;
}

export interface VoiceRecorderPort {
  start(onProgress: (progress: VoiceRecordingProgress) => void): Promise<void>;
  stop(): Promise<RecordedVoice>;
  cancel(): Promise<void>;
  remove(uri: string): Promise<void>;
}

export interface VoicePlaybackProgress {
  positionMs: number;
  durationMs: number;
}

export interface VoicePlayerPort {
  play(
    uri: string,
    onProgress: (progress: VoicePlaybackProgress) => void,
    onComplete: () => void,
  ): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export interface VoiceMetadata {
  duration: number;
  waveform: number[];
}
