import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildVoiceWaveform,
  normalizeMeteringDb,
  type RecordedVoice,
  type VoicePermissionStatus,
} from '@im/sdk-core';
import { sdk } from '../sdk';
import { voicePlaybackCoordinator } from './voicePlaybackCoordinator';

export interface VoiceRecordingUiState {
  active: boolean;
  starting: boolean;
  cancelling: boolean;
  durationMs: number;
  liveLevels: number[];
}

interface Options {
  cid: string;
  onEnqueued(): void;
  onError(reason: string): void;
}

export interface UseVoiceRecordingResult {
  state: VoiceRecordingUiState;
  ensurePermission(): Promise<VoicePermissionStatus>;
  start(): Promise<void>;
  setCancelling(value: boolean): void;
  finish(cancelled: boolean): Promise<void>;
  cancel(): Promise<void>;
}

const INITIAL_STATE: VoiceRecordingUiState = {
  active: false,
  starting: false,
  cancelling: false,
  durationMs: 0,
  liveLevels: [],
};

function errorReason(cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : '';
  if (reason === 'VOICE_TOO_SHORT'
      || reason === 'VOICE_METERING_MISSING'
      || reason === 'VOICE_RECORDING_BUSY'
      || reason === 'VOICE_METADATA_INVALID') {
    return reason;
  }
  return 'VOICE_RECORDING_FAILED';
}

export function useVoiceRecording({ cid, onEnqueued, onError }: Options): UseVoiceRecordingResult {
  const [state, setState] = useState(INITIAL_STATE);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const finishingRef = useRef(false);
  const samplesRef = useRef<number[]>([]);
  const finishRef = useRef<(cancelled: boolean) => Promise<void>>(async () => {});

  const ensurePermission = useCallback(async (): Promise<VoicePermissionStatus> => {
    const current = await sdk.voice.permission.check();
    if (current === 'granted' || current === 'blocked' || current === 'unavailable') {
      return current;
    }
    return sdk.voice.permission.request();
  }, []);

  const finish = useCallback(async (cancelled: boolean): Promise<void> => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const operation = operationRef.current;
    let completionOperation = operation;
    let recorded: RecordedVoice | null = null;
    if (mountedRef.current) {
      setState((current) => ({ ...current, active: false, starting: false, cancelling: cancelled }));
    }
    try {
      if (sdk.voice.recording.getState() === 'recording') {
        recorded = await sdk.voice.recording.finish();
      } else {
        completionOperation = ++operationRef.current;
        await sdk.voice.recording.cancel();
      }
      if (recorded == null || cancelled || operation !== operationRef.current) return;
      if (recorded.durationMs < 1000) throw new Error('VOICE_TOO_SHORT');
      const waveform = buildVoiceWaveform(samplesRef.current);
      await sdk.media.enqueue(cid, 'AUDIO', recorded, {
        duration: Math.min(60, Math.ceil(recorded.durationMs / 1000)),
        waveform,
      });
      if (mountedRef.current && operation === operationRef.current) onEnqueued();
    } catch (cause) {
      if (mountedRef.current && operation === operationRef.current) onError(errorReason(cause));
    } finally {
      if (recorded != null) await sdk.voice.recorder.remove(recorded.uri).catch(() => {});
      await sdk.voice.audioSession.deactivate().catch(() => {});
      if (mountedRef.current && completionOperation === operationRef.current) {
        setState(INITIAL_STATE);
      }
    }
  }, [cid, onEnqueued, onError]);
  finishRef.current = finish;

  const start = useCallback(async (): Promise<void> => {
    if (sdk.voice.recording.getState() !== 'idle') {
      onError('VOICE_RECORDING_BUSY');
      return;
    }
    const operation = ++operationRef.current;
    finishingRef.current = false;
    samplesRef.current = [];
    setState({ ...INITIAL_STATE, starting: true });
    let permission: VoicePermissionStatus;
    try {
      permission = await ensurePermission();
    } catch {
      if (operation === operationRef.current) {
        setState(INITIAL_STATE);
        onError('VOICE_PERMISSION_UNAVAILABLE');
      }
      return;
    }
    if (operation !== operationRef.current) return;
    if (permission !== 'granted') {
      setState(INITIAL_STATE);
      onError(`VOICE_PERMISSION_${permission.toUpperCase()}`);
      return;
    }
    try {
      await voicePlaybackCoordinator.stop();
      if (operation !== operationRef.current) return;
      await sdk.voice.audioSession.activate();
      if (operation !== operationRef.current) {
        await sdk.voice.audioSession.deactivate().catch(() => {});
        return;
      }
      await sdk.voice.recording.start((progress) => {
        if (!mountedRef.current || operation !== operationRef.current) return;
        const level = normalizeMeteringDb(progress.meteringDb);
        if (level != null) samplesRef.current.push(level);
        setState((current) => ({
          ...current,
          active: true,
          starting: false,
          durationMs: progress.durationMs,
          liveLevels: level == null
            ? current.liveLevels
            : [...current.liveLevels, level].slice(-24),
        }));
        if (progress.durationMs >= 60_000 && !finishingRef.current) {
          void finishRef.current(false);
        }
      });
      if (mountedRef.current && operation === operationRef.current && !finishingRef.current) {
        setState((current) => ({ ...current, active: true, starting: false }));
      }
    } catch (cause) {
      await sdk.voice.recording.cancel().catch(() => {});
      await sdk.voice.audioSession.deactivate().catch(() => {});
      if (mountedRef.current && operation === operationRef.current) {
        setState(INITIAL_STATE);
        onError(errorReason(cause));
      }
    }
  }, [ensurePermission, onError]);

  const cancel = useCallback(async (): Promise<void> => {
    await finishRef.current(true);
  }, []);

  const setCancelling = useCallback((value: boolean) => {
    setState((current) => current.active || current.starting
      ? { ...current, cancelling: value }
      : current);
  }, []);

  useEffect(() => {
    const offPause = sdk.voice.audioSession.onPauseRequested(() => {
      void finishRef.current(true);
    });
    return () => offPause();
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    operationRef.current += 1;
    void sdk.voice.recording.cancel();
    void sdk.voice.audioSession.deactivate().catch(() => {});
  }, []);

  return { state, ensurePermission, start, setCancelling, finish, cancel };
}
