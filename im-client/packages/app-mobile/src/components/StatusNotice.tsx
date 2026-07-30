import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

type Tone = 'info' | 'warning' | 'error';

interface Props {
  message: string;
  tone?: Tone;
}

export function StatusNotice({ message, tone = 'info' }: Props) {
  const { theme } = useAppTheme();
  const tones = {
    info: { background: theme.colors.primarySoft, foreground: theme.colors.primary, icon: 'information-circle' as const },
    warning: { background: theme.colors.warningSoft, foreground: theme.colors.warning, icon: 'alert-circle' as const },
    error: { background: theme.colors.dangerSoft, foreground: theme.colors.danger, icon: 'close-circle' as const },
  };
  const selected = tones[tone];
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: selected.background }]}>
      <Ionicons name={selected.icon} size={18} color={selected.foreground} />
      <Text style={[styles.text, { color: selected.foreground }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    minHeight: 44,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  text: { flex: 1, fontSize: TYPE.caption, lineHeight: 18 },
});
