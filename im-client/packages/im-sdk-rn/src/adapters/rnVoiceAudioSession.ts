import type { VoiceAudioSessionPort } from '@im/sdk-core';
import {
  activate,
  addListener,
  AudioContentTypes,
  AudioFocusGainTypes,
  AudioSessionCategory,
  AudioSessionCategoryOptions,
  AudioSessionMode,
  AudioUsages,
  configureAudio,
  deactivate,
} from 'react-native-nitro-audio-manager';

export class RnVoiceAudioSession implements VoiceAudioSessionPort {
  private configured = false;
  private disposed = false;
  private readonly pauseHandlers = new Set<() => void>();
  private readonly removeInterruptionListener: () => void;
  private readonly removeRouteListener: () => void;

  constructor() {
    this.removeInterruptionListener = addListener('audioInterruption', (event) => {
      if (event.type === 'began') this.notifyPauseRequested();
    });
    this.removeRouteListener = addListener('routeChange', (event) => {
      if (event.reason === 'OldDeviceUnavailable') this.notifyPauseRequested();
    });
  }

  async activate(): Promise<void> {
    if (this.disposed) throw new Error('VOICE_AUDIO_SESSION_DISPOSED');
    if (!this.configured) {
      configureAudio({
        ios: {
          category: AudioSessionCategory.PlayAndRecord,
          mode: AudioSessionMode.Default,
          categoryOptions: [
            AudioSessionCategoryOptions.AllowBluetoothHFP,
            AudioSessionCategoryOptions.AllowBluetoothA2DP,
            AudioSessionCategoryOptions.DefaultToSpeaker,
          ],
          prefersInterruptionOnRouteDisconnect: true,
        },
        android: {
          focusGain: AudioFocusGainTypes.GainTransientAllowPause,
          usage: AudioUsages.Media,
          contentType: AudioContentTypes.Speech,
          willPauseWhenDucked: true,
          acceptsDelayedFocusGain: false,
        },
      });
      this.configured = true;
    }
    await activate();
  }

  deactivate(): Promise<void> {
    return deactivate({ restorePreviousSessionOnDeactivation: true });
  }

  onPauseRequested(handler: () => void): () => void {
    this.pauseHandlers.add(handler);
    return () => this.pauseHandlers.delete(handler);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.removeInterruptionListener();
    this.removeRouteListener();
    this.pauseHandlers.clear();
    await this.deactivate().catch(() => {});
  }

  private notifyPauseRequested(): void {
    [...this.pauseHandlers].forEach((handler) => handler());
  }
}
