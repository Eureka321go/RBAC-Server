import React, { type PropsWithChildren, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { resolveMotion, useReducedMotion } from '../ui/motion';

interface Props extends PropsWithChildren, Omit<PressableProps, 'children' | 'style'> {
  style?: StyleProp<ViewStyle>;
  reducedMotionOverride?: boolean;
}

export function PressableScale({
  children,
  disabled,
  onPressIn,
  onPressOut,
  style,
  reducedMotionOverride,
  ...pressableProps
}: Props) {
  const reducedMotion = useReducedMotion(reducedMotionOverride);
  const policy = resolveMotion(reducedMotion);
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number) => {
    if (policy.pressMs === 0) {
      scale.setValue(1);
      return;
    }
    Animated.timing(scale, {
      toValue: value,
      duration: policy.pressMs,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        {...pressableProps}
        disabled={disabled}
        onPressIn={(event) => {
          if (!disabled) animateTo(0.97);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          animateTo(1);
          onPressOut?.(event);
        }}
        style={[styles.target, style]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  target: {
    minWidth: 44,
    minHeight: 44,
  },
});
