import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { IconButton } from './IconButton';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

interface Props {
  visible: boolean;
  muted: boolean;
  busy: boolean;
  onClose: () => void;
  onToggleMuted: () => void;
}

/** 受控会话操作面板；服务端调用和列表刷新由所属页面负责。 */
export function ConversationActionSheet({
  visible,
  muted,
  busy,
  onClose,
  onToggleMuted,
}: Props) {
  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭会话操作"
          disabled={busy}
          style={StyleSheet.absoluteFill}
          onPress={close}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>会话操作</Text>
            <IconButton
              name="close"
              accessibilityLabel="关闭"
              disabled={busy}
              onPress={close}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={muted ? '取消消息免打扰' : '开启消息免打扰'}
            disabled={busy}
            onPress={onToggleMuted}
            style={({ pressed }) => [styles.action, pressed && !busy && styles.pressed]}
          >
            <View style={styles.actionIcon}>
              {busy ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Ionicons
                  name={muted ? 'volume-high-outline' : 'volume-mute-outline'}
                  size={21}
                  color={COLORS.primary}
                />
              )}
            </View>
            <Text style={styles.actionText}>
              {busy ? '正在设置…' : muted ? '取消免打扰' : '消息免打扰'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: COLORS.overlay,
  },
  sheet: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: COLORS.surface,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  title: { color: COLORS.text, fontSize: TYPE.subtitle, fontWeight: '800' },
  action: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  actionText: { color: COLORS.primary, fontSize: TYPE.body, fontWeight: '700' },
  pressed: { opacity: 0.62 },
});
