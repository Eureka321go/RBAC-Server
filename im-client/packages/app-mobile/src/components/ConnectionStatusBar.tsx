import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
  return (
    <View style={[styles.bar, { backgroundColor: COLORS[s] ?? '#6b7280' }]}>
      <Text style={styles.text}>{LABELS[s] ?? s}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingVertical: 6, alignItems: 'center' },
  text: { color: '#fff', fontSize: 13 },
});
