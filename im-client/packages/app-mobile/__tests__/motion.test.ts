import { resolveMotion } from '../src/ui/motion';

describe('motion policy', () => {
  test('uses short restrained motion by default', () => {
    expect(resolveMotion(false)).toEqual({
      enterMs: 240,
      pressMs: 120,
      staggerMs: 30,
      pulse: true,
    });
  });

  test('removes stagger and decorative loops when motion is reduced', () => {
    expect(resolveMotion(true)).toEqual({
      enterMs: 0,
      pressMs: 0,
      staggerMs: 0,
      pulse: false,
    });
  });
});
