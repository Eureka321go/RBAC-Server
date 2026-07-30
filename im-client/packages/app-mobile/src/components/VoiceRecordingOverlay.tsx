import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import type { VoiceRecordingUiState } from '../voice/useVoiceRecording';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
import { useReducedMotion } from '../ui/motion';

export function VoiceRecordingOverlay({
  active,
  starting,
  cancelling,
  durationMs,
  liveLevels,
}: VoiceRecordingUiState) {
  const { theme } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const level = useMemo(
    () => Math.max(0, Math.min(1, liveLevels.at(-1) ?? 0.12)),
    [liveLevels],
  );
  const haloLevel = useRef(new Animated.Value(reducedMotion ? 0 : level)).current;

  useEffect(() => {
    if (reducedMotion) {
      haloLevel.setValue(0);
      return undefined;
    }
    const animation = Animated.timing(haloLevel, {
      toValue: level,
      duration: 100,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [haloLevel, level, reducedMotion]);

  if (!active && !starting) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.center}>
        <View style={[
          styles.card,
          {
            backgroundColor: cancelling
              ? theme.colors.danger
              : theme.colors.recordingOverlay,
          },
        ]}>
          {starting ? (
            <ActivityIndicator size="large" color={theme.colors.white} />
          ) : (
            <>
              <Animated.View
                style={[
                  styles.halo,
                  {
                    backgroundColor: theme.colors.primaryGlow,
                    opacity: haloLevel.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.72, 1],
                    }),
                    transform: [{
                      scale: haloLevel.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.18],
                      }),
                    }],
                  },
                ]}
              >
                <Ionicons name="mic" size={32} color={theme.colors.white} />
              </Animated.View>
              <View style={styles.waveform}>
                {(liveLevels.length > 0 ? liveLevels : [0.12]).map((item, index) => (
                  <View
                    key={index}
                    style={[
                      styles.bar,
                      { height: 5 + item * 22, backgroundColor: theme.colors.white },
                    ]}
                  />
                ))}
              </View>
            </>
          )}
          <Text style={[styles.duration, { color: theme.colors.white }]}>{Math.min(60, Math.ceil(durationMs / 1000))}s</Text>
          <Text style={[styles.hint, { color: theme.colors.white }]}>
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
  },
  halo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveform: { height: 28, flexDirection: 'row', alignItems: 'center', gap: 3 },
  bar: { width: 4, borderRadius: RADIUS.pill },
  duration: { fontSize: TYPE.title, fontWeight: '800' },
  hint: { fontSize: TYPE.body, fontWeight: '600' },
});
