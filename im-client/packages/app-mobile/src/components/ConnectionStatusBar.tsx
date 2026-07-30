import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../store';
import { useAppTheme } from '../ui/ThemeProvider';
import { PresenceDot } from './PresenceDot';

const LABELS: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中…',
  reconnecting: '重连中…',
  closed: '未连接',
};

export function ConnectionStatusBar() {
  const state = useAppStore((x) => x.connState);
  const { theme } = useAppTheme();
  const { colors: themeColors } = theme;
  if (state === 'connected') {
    return <SafeAreaView edges={['top']} style={{ backgroundColor: themeColors.surface }} />;
  }
  const statusColors: Record<string, { background: string; foreground: string }> = {
    connecting: { background: themeColors.warningSoft, foreground: themeColors.warning },
    reconnecting: { background: themeColors.warningSoft, foreground: themeColors.warning },
    closed: { background: themeColors.dangerSoft, foreground: themeColors.danger },
  };
  const colors = statusColors[state] ?? {
    background: themeColors.surfaceMuted,
    foreground: themeColors.textSecondary,
  };
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
      <View style={styles.bar}>
        <PresenceDot
          color={colors.foreground}
          size={6}
          pulse={state === 'connecting' || state === 'reconnecting'}
        />
        <Text style={[styles.text, { color: colors.foreground }]}>
          {LABELS[state] ?? state}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  text: { fontSize: 12, fontWeight: '600' },
});
