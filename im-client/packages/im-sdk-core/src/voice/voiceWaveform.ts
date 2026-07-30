import type { VoiceMetadata } from './voiceTypes';

export const VOICE_WAVEFORM_POINTS = 48;
export const VOICE_MIN_DB = -60;
export const VOICE_MAX_DB = 0;

export function normalizeMeteringDb(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const db = Math.max(VOICE_MIN_DB, Math.min(VOICE_MAX_DB, value));
  return Math.pow(10, db / 20);
}

export function buildVoiceWaveform(samples: readonly number[]): number[] {
  const valid = samples.filter(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
  if (valid.length === 0) throw new Error('VOICE_METERING_MISSING');

  const peaks = Array.from({ length: VOICE_WAVEFORM_POINTS }, (_, index) => {
    const from = Math.floor((index * valid.length) / VOICE_WAVEFORM_POINTS);
    const to = Math.max(
      from + 1,
      Math.ceil(((index + 1) * valid.length) / VOICE_WAVEFORM_POINTS),
    );
    let peak = valid[Math.min(from, valid.length - 1)] ?? 0;
    for (let cursor = from; cursor < Math.min(to, valid.length); cursor += 1) {
      peak = Math.max(peak, valid[cursor]);
    }
    return peak;
  });

  return peaks.map((peak, index) => {
    const previous = peaks[Math.max(0, index - 1)];
    const next = peaks[Math.min(peaks.length - 1, index + 1)];
    const smoothed = previous * 0.2 + peak * 0.6 + next * 0.2;
    return Math.round(Math.max(0, Math.min(1, smoothed)) * 100);
  });
}

export function parseVoiceMetadata(
  body: Record<string, unknown> | null,
): VoiceMetadata | null {
  const duration = body?.duration;
  const waveform = body?.waveform;
  if (
    typeof duration !== 'number'
    || !Number.isInteger(duration)
    || duration < 1
    || duration > 60
  ) {
    return null;
  }
  if (!Array.isArray(waveform) || waveform.length !== VOICE_WAVEFORM_POINTS) {
    return null;
  }
  if (!waveform.every(
    (value) => typeof value === 'number'
      && Number.isInteger(value)
      && value >= 0
      && value <= 100,
  )) {
    return null;
  }
  return { duration, waveform: [...waveform] };
}

export const FALLBACK_VOICE_WAVEFORM: readonly number[] = Array.from(
  { length: VOICE_WAVEFORM_POINTS },
  (_, index) => 28 + (index % 4) * 8,
);
