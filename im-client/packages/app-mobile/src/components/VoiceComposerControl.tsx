import React, { useMemo, useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton } from './IconButton';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

interface Props {
  voiceMode: boolean;
  disabled: boolean;
  active: boolean;
  onToggleMode(): void;
  onStart(): Promise<void>;
  onCancellingChange(value: boolean): void;
  onFinish(cancelled: boolean): Promise<void>;
}

export function VoiceComposerControl({
  voiceMode,
  disabled,
  active,
  onToggleMode,
  onStart,
  onCancellingChange,
  onFinish,
}: Props) {
  const cancellingRef = useRef(false);
  const gestureActiveRef = useRef(false);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => voiceMode && !disabled,
    onMoveShouldSetPanResponder: () => voiceMode && !disabled,
    onPanResponderGrant: () => {
      gestureActiveRef.current = true;
      cancellingRef.current = false;
      onCancellingChange(false);
      void onStart();
    },
    onPanResponderMove: (_event, gesture) => {
      const cancelling = gesture.dy <= -80;
      if (cancelling === cancellingRef.current) return;
      cancellingRef.current = cancelling;
      onCancellingChange(cancelling);
    },
    onPanResponderRelease: () => {
      if (!gestureActiveRef.current) return;
      gestureActiveRef.current = false;
      void onFinish(cancellingRef.current);
    },
    onPanResponderTerminate: () => {
      if (!gestureActiveRef.current) return;
      gestureActiveRef.current = false;
      void onFinish(true);
    },
    onPanResponderTerminationRequest: () => false,
  }), [disabled, onCancellingChange, onFinish, onStart, voiceMode]);

  return (
    <View style={styles.wrap}>
      <IconButton
        name={voiceMode ? 'keypad-outline' : 'mic-outline'}
        accessibilityLabel={voiceMode ? '切换到文字输入' : '切换到语音输入'}
        disabled={disabled || active}
        color={COLORS.primary}
        onPress={onToggleMode}
      />
      {voiceMode ? (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="按住说话"
          disabled={disabled}
          {...panResponder.panHandlers}
          style={({ pressed }) => [
            styles.holdButton,
            (pressed || active) && styles.holdButtonActive,
            disabled && styles.disabled,
          ]}
        >
          <Text style={styles.holdText}>{active ? '松开发送' : '按住说话'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  holdButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
  },
  holdButtonActive: { backgroundColor: COLORS.primarySoft, borderColor: COLORS.primary },
  holdText: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
