import type { VoicePlaybackProgress, VoicePlayerPort } from '@im/sdk-core';
import { createSound } from 'react-native-nitro-sound';

export class RnVoicePlayer implements VoicePlayerPort {
  private readonly sound = createSound();
  private operation = 0;
  private active = false;

  constructor() {
    this.sound.setSubscriptionDuration(0.1);
  }

  async play(
    uri: string,
    onProgress: (progress: VoicePlaybackProgress) => void,
    onComplete: () => void,
  ): Promise<void> {
    await this.stop();
    const operation = ++this.operation;
    this.sound.addPlayBackListener((event) => {
      if (this.operation !== operation) return;
      onProgress({ positionMs: event.currentPosition, durationMs: event.duration });
    });
    this.sound.addPlaybackEndListener((event) => {
      if (this.operation !== operation) return;
      this.active = false;
      this.removeListeners();
      onProgress({ positionMs: event.duration, durationMs: event.duration });
      onComplete();
    });
    try {
      await this.sound.startPlayer(uri);
      if (this.operation !== operation) {
        await this.sound.stopPlayer().catch(() => {});
        return;
      }
      this.active = true;
    } catch (cause) {
      if (this.operation === operation) this.removeListeners();
      throw cause;
    }
  }

  async pause(): Promise<void> {
    if (this.active) await this.sound.pausePlayer();
  }

  async resume(): Promise<void> {
    if (this.active) await this.sound.resumePlayer();
  }

  async stop(): Promise<void> {
    this.operation += 1;
    this.removeListeners();
    if (!this.active) return;
    this.active = false;
    await this.sound.stopPlayer().catch(() => {});
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  private removeListeners(): void {
    this.sound.removePlayBackListener();
    this.sound.removePlaybackEndListener();
  }
}
