import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../store';

const COLORS: Record<string, string> = {
  connected: '#16a34a',
  connecting: '#d97706',
  reconnecting: '#d97706',
  closed: '#dc2626',
};

const LABELS: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中…',
  reconnecting: '重连中…',
  closed: '未连接',
};

export function ConnectionStatusBar() {
  const s = useAppStore((x) => x.connState);
  const backgroundColor = COLORS[s] ?? '#6b7280';
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor }}>
      <View style={styles.bar}>
        <View style={styles.dot} />
        <Text style={styles.text}>{LABELS[s] ?? s}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ffffff' },
  text: { color: '#fff', fontSize: 13 },
});
