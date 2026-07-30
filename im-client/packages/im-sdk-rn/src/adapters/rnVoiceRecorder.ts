import type {
  RecordedVoice,
  VoiceRecorderPort,
  VoiceRecordingProgress,
} from '@im/sdk-core';
import { Dirs, FileSystem } from 'react-native-file-access';
import {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  AVEncoderAudioQualityIOSType,
  createSound,
  OutputFormatAndroidType,
  type AudioSet,
} from 'react-native-nitro-sound';

const RECORDING_OPTIONS: AudioSet = {
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AVEncodingOptionIOS: 'aac',
  AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.medium,
  AudioSamplingRate: 16000,
  AudioEncodingBitRate: 32000,
  AudioChannels: 1,
};
const RECORDING_PATH = `${Dirs.CacheDir}/im-voice-recording.m4a`;

function leafName(uri: string): string {
  const path = uri.replace(/\\/g, '/');
  return path.slice(path.lastIndexOf('/') + 1) || `voice-${Date.now()}.m4a`;
}

export class RnVoiceRecorder implements VoiceRecorderPort {
  private readonly sound = createSound();
  private operation = 0;
  private active = false;
  private uri: string | null = null;
  private durationMs = 0;

  constructor() {
    this.sound.setSubscriptionDuration(0.1);
  }

  async start(onProgress: (progress: VoiceRecordingProgress) => void): Promise<void> {
    if (this.active) throw new Error('VOICE_RECORDER_BUSY');
    const operation = ++this.operation;
    this.durationMs = 0;
    this.sound.addRecordBackListener((event) => {
      if (this.operation !== operation) return;
      this.durationMs = Math.max(this.durationMs, event.currentPosition);
      onProgress({
        durationMs: event.currentPosition,
        meteringDb: event.currentMetering ?? null,
      });
    });
    try {
      const uri = await this.sound.startRecorder(RECORDING_PATH, RECORDING_OPTIONS, true);
      if (this.operation !== operation) {
        await this.sound.stopRecorder().catch(() => {});
        await this.remove(uri).catch(() => {});
        return;
      }
      this.uri = uri;
      this.active = true;
    } catch (cause) {
      if (this.operation === operation) this.sound.removeRecordBackListener();
      throw cause;
    }
  }

  async stop(): Promise<RecordedVoice> {
    if (!this.active) throw new Error('VOICE_RECORDER_IDLE');
    const operation = ++this.operation;
    this.active = false;
    const uri = await this.sound.stopRecorder();
    this.sound.removeRecordBackListener();
    this.uri = uri || this.uri;
    if (this.uri == null) throw new Error('VOICE_RECORDING_MISSING');
    const stat = await FileSystem.stat(this.uri);
    if (this.operation !== operation) throw new Error('VOICE_RECORDING_CANCELLED');
    return {
      uri: this.uri,
      filename: leafName(this.uri),
      mime: 'audio/mp4',
      size: stat.size,
      durationMs: this.durationMs,
    };
  }

  async cancel(): Promise<void> {
    this.operation += 1;
    const uri = this.uri;
    this.uri = null;
    this.sound.removeRecordBackListener();
    if (this.active) {
      this.active = false;
      const stoppedUri = await this.sound.stopRecorder().catch(() => null);
      if (stoppedUri != null) await this.remove(stoppedUri).catch(() => {});
    }
    if (uri != null) await this.remove(uri).catch(() => {});
  }

  async remove(uri: string): Promise<void> {
    if (await FileSystem.exists(uri)) await FileSystem.unlink(uri);
  }
}
