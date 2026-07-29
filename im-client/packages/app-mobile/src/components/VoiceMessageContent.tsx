import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
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
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

interface Props {
  message: ChatMessage;
  accountId: number;
  mine: boolean;
  heard: boolean;
  onHeard(): void;
  onError(message: string): void;
}

export function VoiceMessageContent({
  message,
  accountId,
  mine,
  heard,
  onHeard,
  onError,
}: Props) {
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
      disabled={disabled || status === 'downloading'}
      onPress={() => {
        void voicePlaybackCoordinator.toggle({ message, accountId, mine, onHeard });
      }}
      style={({ pressed }) => [
        styles.wrap,
        { width: Math.min(250, 116 + duration * 2) },
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.control}>
        {status === 'downloading' ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <Ionicons name={icon} size={22} color={COLORS.primary} />
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
                  backgroundColor: played ? COLORS.primary : COLORS.textSecondary,
                },
              ]}
            />
          );
        })}
      </View>
      <Text style={styles.duration}>{duration}''</Text>
      {!mine && !heard ? <View accessibilityLabel="未听" style={styles.unheard} /> : null}
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
  waveform: { flex: 1, height: 30, flexDirection: 'row', alignItems: 'center', gap: 1 },
  bar: { flex: 1, minWidth: 1, borderRadius: RADIUS.pill },
  duration: { color: COLORS.textSecondary, fontSize: TYPE.caption, minWidth: 22 },
  unheard: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.danger,
  },
  pressed: { opacity: 0.68 },
});
