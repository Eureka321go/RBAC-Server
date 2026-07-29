import React, { type PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { COLORS, RADIUS } from '../ui/theme';

interface Props extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
}

export function Surface({ children, style }: Props) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
});
