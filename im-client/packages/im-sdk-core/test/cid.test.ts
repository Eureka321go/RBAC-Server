import { describe, it, expect } from 'vitest';
import { buildSingleCid, parseCid } from '../src/index';

describe('cid', () => {
  it('builds single cid with ascending user ids', () => {
    expect(buildSingleCid(2, 1)).toBe('c_1_2');
    expect(buildSingleCid(1, 2)).toBe('c_1_2');
  });

  it('parses single cid', () => {
    expect(parseCid('c_1_2')).toEqual({ type: 'SINGLE', groupId: null });
  });

  it('parses group cid', () => {
    expect(parseCid('g_77')).toEqual({ type: 'GROUP', groupId: 77 });
  });

  it('treats unknown shape as SINGLE without group id', () => {
    expect(parseCid('weird')).toEqual({ type: 'SINGLE', groupId: null });
  });
});
