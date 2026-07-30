import React, { type PropsWithChildren, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RADIUS, SPACING } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

interface Props extends PropsWithChildren {
  header?: ReactNode;
  footer?: ReactNode;
}

export function ChatComposerSurface({ header, children, footer }: Props) {
  const { theme } = useAppTheme();
  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <View
        style={[
          styles.surface,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.border,
          },
        ]}
      >
        {header}
        <View style={styles.row}>{children}</View>
        {footer}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: 'transparent' },
  surface: {
    marginHorizontal: SPACING.sm,
    marginTop: SPACING.xxs,
    marginBottom: SPACING.xs,
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    minHeight: 58,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xxs,
  },
});
