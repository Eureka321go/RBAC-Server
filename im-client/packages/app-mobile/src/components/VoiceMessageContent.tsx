import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import {
  FALLBACK_VOICE_WAVEFORM,
  parseVoiceMetadata,
  type ChatMessage,
} from '@im/sdk-core';
import {
  voiceMessageKey,
  voicePlaybackCoordinator,
} from '../voice/voicePlaybackCoordinator';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

interface Props {
  message: ChatMessage;
  accountId: number;
  mine: boolean;
  heard: boolean;
  onHeard(): void;
  onError(message: string): void;
  onLongPress?: () => void;
}

export function VoiceMessageContent({
  message,
  accountId,
  mine,
  heard,
  onHeard,
  onError,
  onLongPress,
}: Props) {
  const { theme } = useAppTheme();
  const longPressedRef = useRef(false);
  const snapshot = useSyncExternalStore(
    voicePlaybackCoordinator.subscribe,
    voicePlaybackCoordinator.getSnapshot,
  );
  const key = voiceMessageKey(message);
  const active = snapshot.key === key;
  const metadata = useMemo(() => parseVoiceMetadata(message.body), [message.body]);
  const duration = metadata?.duration ?? 1;
  const waveform = metadata?.waveform ?? FALLBACK_VOICE_WAVEFORM;
  const disabled = message.status === 'uploading';

  useEffect(() => {
    if (snapshot.key === key && snapshot.error != null) onError(snapshot.error);
  }, [key, onError, snapshot.error, snapshot.key]);

  const status = active ? snapshot.status : 'idle';
  const icon = status === 'paused' ? 'play' : status === 'playing' ? 'pause' : 'play';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status === 'playing' ? '暂停语音' : '播放语音'}
      disabled={(disabled || status === 'downloading') && onLongPress == null}
      delayLongPress={350}
      onLongPress={() => {
        longPressedRef.current = true;
        onLongPress?.();
      }}
      onPress={() => {
        if (longPressedRef.current) {
          longPressedRef.current = false;
          return;
        }
        if (disabled || status === 'downloading') return;
        void voicePlaybackCoordinator.toggle({ message, accountId, mine, onHeard });
      }}
      onPressIn={() => {
        longPressedRef.current = false;
      }}
      style={({ pressed }) => [
        styles.wrap,
        { width: Math.min(250, 116 + duration * 2) },
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.control}>
        {status === 'downloading' ? (
          <ActivityIndicator size="small" color={theme.colors.voiceWavePlayed} />
        ) : (
          <Ionicons name={icon} size={22} color={theme.colors.voiceWavePlayed} />
        )}
      </View>
      <View style={styles.waveform}>
        {waveform.map((value, index) => {
          const played = active && index / waveform.length < snapshot.progress;
          return (
            <View
              key={index}
              style={[
                styles.bar,
                {
                  height: 6 + (value / 100) * 22,
                  backgroundColor: played
                    ? theme.colors.voiceWavePlayed
                    : theme.colors.voiceWaveIdle,
                },
              ]}
            />
          );
        })}
      </View>
      <Text style={[styles.duration, { color: theme.colors.textSecondary }]}>{duration}''</Text>
      {!mine && !heard ? (
        <View
          accessibilityLabel="未听"
          style={[styles.unheard, { backgroundColor: theme.colors.voiceUnread }]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 116,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  control: { width: 22, alignItems: 'center', justifyContent: 'center' },
  waveform: {
    flex: 1,
    height: 30,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  bar: { flex: 1, borderRadius: RADIUS.pill, transform: [{ scaleX: 0.55 }] },
  duration: {
    minWidth: 22,
    flexShrink: 0,
    fontSize: TYPE.caption,
    textAlign: 'right',
  },
  unheard: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: RADIUS.pill,
  },
  pressed: { opacity: 0.68 },
});
