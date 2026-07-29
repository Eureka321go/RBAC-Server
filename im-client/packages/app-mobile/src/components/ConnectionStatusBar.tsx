import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../store';
import { COLORS } from '../ui/theme';

const STATUS_COLORS: Record<string, { background: string; foreground: string }> = {
  connected: { background: COLORS.successSoft, foreground: COLORS.success },
  connecting: { background: COLORS.warningSoft, foreground: COLORS.warning },
  reconnecting: { background: COLORS.warningSoft, foreground: COLORS.warning },
  closed: { background: COLORS.dangerSoft, foreground: COLORS.danger },
};

const LABELS: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中…',
  reconnecting: '重连中…',
  closed: '未连接',
};

export function ConnectionStatusBar() {
  const state = useAppStore((x) => x.connState);
  if (state === 'connected') {
    return <SafeAreaView edges={['top']} style={styles.connectedSafeArea} />;
  }
  const colors = STATUS_COLORS[state] ?? {
    background: COLORS.surfaceMuted,
    foreground: COLORS.textSecondary,
  };
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
      <View style={styles.bar}>
        <View style={[styles.dot, { backgroundColor: colors.foreground }]} />
        <Text style={[styles.text, { color: colors.foreground }]}>
          {LABELS[state] ?? state}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  connectedSafeArea: { backgroundColor: COLORS.surface },
  bar: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 12, fontWeight: '600' },
});
