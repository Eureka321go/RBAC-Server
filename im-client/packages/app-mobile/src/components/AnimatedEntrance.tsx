import React, { type PropsWithChildren, useEffect, useRef } from 'react';
import {
  Animated,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { resolveMotion, useReducedMotion } from '../ui/motion';

interface Props extends PropsWithChildren {
  index?: number;
  style?: StyleProp<ViewStyle>;
  reducedMotionOverride?: boolean;
}

export function AnimatedEntrance({
  children,
  index = 0,
  style,
  reducedMotionOverride,
}: Props) {
  const reducedMotion = useReducedMotion(reducedMotionOverride);
  const policy = resolveMotion(reducedMotion);
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (policy.enterMs === 0) {
      progress.setValue(1);
      return undefined;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: policy.enterMs,
      delay: Math.min(index, 4) * policy.staggerMs,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, policy.enterMs, policy.staggerMs, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [10, 0],
            }),
          }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
