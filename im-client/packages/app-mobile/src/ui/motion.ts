import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export interface MotionPolicy {
  enterMs: number;
  pressMs: number;
  staggerMs: number;
  pulse: boolean;
}

export function resolveMotion(reduceMotion: boolean): MotionPolicy {
  return reduceMotion
    ? { enterMs: 0, pressMs: 0, staggerMs: 0, pulse: false }
    : { enterMs: 240, pressMs: 120, staggerMs: 30, pulse: true };
}

export function useReducedMotion(override?: boolean): boolean {
  const [reducedMotion, setReducedMotion] = useState(override ?? false);

  useEffect(() => {
    if (override != null) {
      setReducedMotion(override);
      return undefined;
    }
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReducedMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, [override]);

  return reducedMotion;
}
