import React, { type PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { RADIUS } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

interface Props extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
}

export function Surface({ children, style }: Props) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.surface,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
