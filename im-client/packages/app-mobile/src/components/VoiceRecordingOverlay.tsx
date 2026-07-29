import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { VoiceRecordingUiState } from '../voice/useVoiceRecording';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

export function VoiceRecordingOverlay({
  active,
  starting,
  cancelling,
  durationMs,
  liveLevels,
}: VoiceRecordingUiState) {
  if (!active && !starting) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.center}>
        <View style={[styles.card, cancelling && styles.cardCancelling]}>
          {starting ? (
            <ActivityIndicator size="large" color={COLORS.white} />
          ) : (
            <View style={styles.waveform}>
              {(liveLevels.length > 0 ? liveLevels : [0.12]).map((level, index) => (
                <View key={index} style={[styles.bar, { height: 8 + level * 36 }]} />
              ))}
            </View>
          )}
          <Text style={styles.duration}>{Math.min(60, Math.ceil(durationMs / 1000))}s</Text>
          <Text style={styles.hint}>
            {starting ? '正在启动录音' : cancelling ? '松开取消' : '上滑取消，松开发送'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    width: 230,
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
  },
  cardCancelling: { backgroundColor: COLORS.danger },
  waveform: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 3 },
  bar: { width: 4, borderRadius: RADIUS.pill, backgroundColor: COLORS.white },
  duration: { color: COLORS.white, fontSize: TYPE.title, fontWeight: '800' },
  hint: { color: COLORS.white, fontSize: TYPE.body, fontWeight: '600' },
});
