import { describe, it, expect } from 'vitest';
import { SDK_VERSION } from '../src/index';

describe('smoke', () => {
  it('exposes SDK_VERSION', () => {
    expect(SDK_VERSION).toBe('0.0.0');
  });
});
