import type {
  RecordedVoice,
  VoiceRecorderPort,
  VoiceRecordingProgress,
} from './voiceTypes';

export type VoiceRecordingState = 'idle' | 'starting' | 'recording' | 'finishing';

export class VoiceRecordingController {
  private state: VoiceRecordingState = 'idle';
  private operation = 0;

  constructor(private readonly recorder: VoiceRecorderPort) {}

  getState(): VoiceRecordingState {
    return this.state;
  }

  async start(onProgress: (progress: VoiceRecordingProgress) => void): Promise<void> {
    if (this.state !== 'idle') throw new Error('VOICE_RECORDING_BUSY');
    const operation = ++this.operation;
    this.state = 'starting';
    try {
      await this.recorder.start((progress) => {
        if (this.operation === operation && this.state === 'recording') {
          onProgress(progress);
        }
      });
      if (this.operation !== operation) {
        await this.recorder.cancel().catch(() => {});
        return;
      }
      this.state = 'recording';
    } catch (cause) {
      if (this.operation !== operation) return;
      this.state = 'idle';
      throw cause;
    }
  }

  async finish(): Promise<RecordedVoice | null> {
    if (this.state !== 'recording') return null;
    const operation = this.operation;
    this.state = 'finishing';
    try {
      return await this.recorder.stop();
    } finally {
      if (this.operation === operation) this.state = 'idle';
    }
  }

  async cancel(): Promise<void> {
    if (this.state === 'idle') return;
    this.operation += 1;
    this.state = 'idle';
    await this.recorder.cancel().catch(() => {});
  }
}
