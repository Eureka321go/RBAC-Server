import { describe, it, expect } from 'vitest';
import { Emitter } from '../src/index';

type E = { ping: { n: number } };

describe('Emitter', () => {
  it('delivers emitted payloads to subscribers', () => {
    const em = new Emitter<E>();
    const seen: number[] = [];
    em.on('ping', (p) => seen.push(p.n));
    em.emit('ping', { n: 1 });
    em.emit('ping', { n: 2 });
    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribe via returned disposer stops delivery', () => {
    const em = new Emitter<E>();
    const seen: number[] = [];
    const off = em.on('ping', (p) => seen.push(p.n));
    em.emit('ping', { n: 1 });
    off();
    em.emit('ping', { n: 2 });
    expect(seen).toEqual([1]);
  });
});
