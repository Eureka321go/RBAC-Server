import { describe, it, expect } from 'vitest';
import { OP, isMedia } from '../src/index';

describe('protocol', () => {
  it('OP has stable string values', () => {
    expect(OP.SEND).toBe('SEND');
    expect(OP.PUSH).toBe('PUSH');
    expect(OP.READ).toBe('READ');
  });

  it('isMedia is true only for IMAGE/AUDIO/FILE', () => {
    expect(isMedia('IMAGE')).toBe(true);
    expect(isMedia('AUDIO')).toBe(true);
    expect(isMedia('FILE')).toBe(true);
    expect(isMedia('TEXT')).toBe(false);
  });

  it('isMedia is null-safe', () => {
    expect(isMedia(null)).toBe(false);
    expect(isMedia(undefined)).toBe(false);
  });
});
