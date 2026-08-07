import React from 'react';
import { Image, StyleSheet, type ImageStyle, type StyleProp } from 'react-native';
import { useAppTheme } from '../ui/ThemeProvider';

interface Props {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export function BrandMark({ size = 64, style }: Props) {
  const { theme } = useAppTheme();
  return (
    <Image
      accessible
      accessibilityRole="image"
      accessibilityLabel="RayIM 标志"
      source={theme.isDark
        ? require('../assets/rayim-signal-ribbon.png')
        : require('../assets/rayim-signal-ribbon-light.png')}
      resizeMode="contain"
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size * 0.28 },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  mark: { overflow: 'hidden' },
});
