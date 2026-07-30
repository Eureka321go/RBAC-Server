import type { ChatMessage } from '@im/sdk-core';
import { sdk } from '../sdk';

export interface VoicePlaybackSnapshot {
  key: string | null;
  status: 'idle' | 'downloading' | 'playing' | 'paused';
  progress: number;
  error: string | null;
}

interface ToggleOptions {
  message: ChatMessage;
  accountId: number;
  mine: boolean;
  onHeard(): void;
}

const IDLE_SNAPSHOT: VoicePlaybackSnapshot = {
  key: null,
  status: 'idle',
  progress: 0,
  error: null,
};

export function voiceMessageKey(message: ChatMessage): string {
  return message.seq != null
    ? `${message.cid}:${message.seq}`
    : `${message.cid}:local:${message.clientMsgId ?? 'pending'}`;
}

class VoicePlaybackCoordinator {
  private snapshot: VoicePlaybackSnapshot = IDLE_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private operation = 0;

  constructor() {
    sdk.voice.audioSession.onPauseRequested(() => {
      void this.pause();
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VoicePlaybackSnapshot => this.snapshot;

  async toggle(options: ToggleOptions): Promise<void> {
    const key = voiceMessageKey(options.message);
    if (this.snapshot.key === key && this.snapshot.status === 'playing') {
      await this.pause();
      return;
    }
    if (this.snapshot.key === key && this.snapshot.status === 'paused') {
      try {
        await sdk.voice.audioSession.activate();
        await sdk.voice.player.resume();
        this.update({ ...this.snapshot, status: 'playing', error: null });
      } catch (cause) {
        await this.fail(cause);
      }
      return;
    }

    await this.stop();
    const operation = ++this.operation;
    this.update({ key, status: 'downloading', progress: 0, error: null });
    try {
      const uri = await this.resolveUri(options.message);
      if (operation !== this.operation) return;
      await sdk.voice.audioSession.activate();
      if (operation !== this.operation) {
        await sdk.voice.audioSession.deactivate().catch(() => {});
        return;
      }
      await sdk.voice.player.play(
        uri,
        ({ positionMs, durationMs }) => {
          if (operation !== this.operation || durationMs <= 0) return;
          this.update({
            key,
            status: 'playing',
            progress: Math.max(0, Math.min(1, positionMs / durationMs)),
            error: null,
          });
        },
        () => {
          if (operation !== this.operation) return;
          this.operation += 1;
          this.update(IDLE_SNAPSHOT);
          void sdk.voice.audioSession.deactivate().catch(() => {});
          if (!options.mine && options.message.seq != null) {
            void sdk.voice.heard
              .markHeard(options.accountId, options.message.cid, options.message.seq)
              .then(options.onHeard)
              .catch(() => {});
          }
        },
      );
      if (operation === this.operation) {
        this.update({ key, status: 'playing', progress: 0, error: null });
      }
    } catch (cause) {
      if (operation === this.operation) await this.fail(cause);
    }
  }

  async pause(): Promise<void> {
    if (this.snapshot.status !== 'playing') return;
    try {
      await sdk.voice.player.pause();
      this.update({ ...this.snapshot, status: 'paused' });
    } catch (cause) {
      await this.fail(cause);
    } finally {
      await sdk.voice.audioSession.deactivate().catch(() => {});
    }
  }

  async stop(): Promise<void> {
    this.operation += 1;
    await sdk.voice.player.stop().catch(() => {});
    await sdk.voice.audioSession.deactivate().catch(() => {});
    this.update(IDLE_SNAPSHOT);
  }

  private async resolveUri(message: ChatMessage): Promise<string> {
    const localUri = message.body?.localUri;
    if (typeof localUri === 'string' && localUri !== '') return localUri;
    const objectKey = message.body?.objectKey;
    const filename = message.body?.filename;
    if (typeof objectKey !== 'string' || typeof filename !== 'string') {
      throw new Error('VOICE_SOURCE_MISSING');
    }
    return sdk.media.downloadToCache(message.cid, objectKey, filename);
  }

  private async fail(_cause: unknown): Promise<void> {
    const key = this.snapshot.key;
    this.operation += 1;
    await sdk.voice.player.stop().catch(() => {});
    await sdk.voice.audioSession.deactivate().catch(() => {});
    this.update({ key, status: 'idle', progress: 0, error: 'VOICE_PLAYBACK_FAILED' });
  }

  private update(snapshot: VoicePlaybackSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

export const voicePlaybackCoordinator = new VoicePlaybackCoordinator();
