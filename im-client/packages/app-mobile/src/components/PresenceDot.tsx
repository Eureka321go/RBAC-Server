import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type ViewStyle } from 'react-native';
import { resolveMotion, useReducedMotion } from '../ui/motion';

interface Props {
  color: string;
  size?: number;
  pulse?: boolean;
  style?: ViewStyle;
  reducedMotionOverride?: boolean;
}

export function PresenceDot({
  color,
  size = 8,
  pulse = false,
  style,
  reducedMotionOverride,
}: Props) {
  const reducedMotion = useReducedMotion(reducedMotionOverride);
  const opacity = useRef(new Animated.Value(1)).current;
  const shouldPulse = pulse && resolveMotion(reducedMotion).pulse;

  useEffect(() => {
    opacity.setValue(1);
    if (!shouldPulse) return undefined;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, {
        toValue: 0.55,
        duration: 900,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity, shouldPulse]);

  return (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: color, width: size, height: size, borderRadius: size / 2, opacity },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { flexShrink: 0 },
});
