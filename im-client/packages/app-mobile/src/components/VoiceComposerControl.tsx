import React, { useMemo, useRef } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { IconButton } from './IconButton';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

interface Props {
  voiceMode: boolean;
  disabled: boolean;
  active: boolean;
  iconStyle?: StyleProp<ViewStyle>;
  onToggleMode(): void;
  onStart(): Promise<void>;
  onCancellingChange(value: boolean): void;
  onFinish(cancelled: boolean): Promise<void>;
}

export function VoiceComposerControl({
  voiceMode,
  disabled,
  active,
  iconStyle,
  onToggleMode,
  onStart,
  onCancellingChange,
  onFinish,
}: Props) {
  const cancellingRef = useRef(false);
  const gestureActiveRef = useRef(false);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => voiceMode && !disabled && !active,
    onMoveShouldSetPanResponder: () => voiceMode && !disabled && !active,
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
  }), [active, disabled, onCancellingChange, onFinish, onStart, voiceMode]);

  if (!voiceMode) {
    return (
      <IconButton
        name="mic-outline"
        accessibilityLabel="切换到语音输入"
        disabled={disabled || active}
        color={COLORS.primary}
        style={iconStyle}
        onPress={onToggleMode}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <IconButton
        name="keypad-outline"
        accessibilityLabel="切换到文字输入"
        disabled={disabled || active}
        color={COLORS.primary}
        style={iconStyle}
        onPress={onToggleMode}
      />
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel="按住说话"
        accessibilityState={{ disabled: disabled && !active }}
        {...panResponder.panHandlers}
        style={[
          styles.holdButton,
          active && styles.holdButtonActive,
          disabled && styles.disabled,
        ]}
      >
        <Text style={styles.holdText}>{active ? '松开发送' : '按住说话'}</Text>
      </View>
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
