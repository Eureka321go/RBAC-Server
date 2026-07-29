import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

type Tone = 'info' | 'warning' | 'error';

interface Props {
  message: string;
  tone?: Tone;
}

const tones = {
  info: { background: COLORS.primarySoft, foreground: COLORS.primary, icon: 'information-circle' as const },
  warning: { background: COLORS.warningSoft, foreground: COLORS.warning, icon: 'alert-circle' as const },
  error: { background: COLORS.dangerSoft, foreground: COLORS.danger, icon: 'close-circle' as const },
};

export function StatusNotice({ message, tone = 'info' }: Props) {
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
