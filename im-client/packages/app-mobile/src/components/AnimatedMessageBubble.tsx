import React, { type PropsWithChildren, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useReducedMotion } from '../ui/motion';

interface Props extends PropsWithChildren {
  messageId: string;
  isMine: boolean;
  animateOnMount: boolean;
  reducedMotionOverride?: boolean;
}

export function AnimatedMessageBubble({
  children,
  messageId,
  isMine,
  animateOnMount,
  reducedMotionOverride,
}: Props) {
  const reducedMotion = useReducedMotion(reducedMotionOverride);
  const shouldAnimate = animateOnMount && !reducedMotion;
  const progress = useRef(new Animated.Value(shouldAnimate ? 0 : 1)).current;

  useEffect(() => {
    if (!shouldAnimate) {
      progress.setValue(1);
      return undefined;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [messageId, progress, shouldAnimate]);

  return (
    <Animated.View
      testID={`message-motion-${isMine ? 'mine' : 'peer'}`}
      style={{
        opacity: progress,
        transform: [
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0.96, 1],
            }),
          },
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [8, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
