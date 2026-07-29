import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { IconButton } from './IconButton';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onRecall: () => void;
}

/** 受控消息操作面板；业务权限和 SDK 调用由所属页面负责。 */
export function MessageActionSheet({ visible, onClose, onRecall }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭消息操作"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>消息操作</Text>
            <IconButton name="close" accessibilityLabel="关闭" onPress={onClose} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="撤回消息"
            onPress={onRecall}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <View style={styles.actionIcon}>
              <Ionicons name="arrow-undo-outline" size={21} color={COLORS.danger} />
            </View>
            <Text style={styles.actionText}>撤回</Text>
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
    backgroundColor: COLORS.dangerSoft,
  },
  actionText: { color: COLORS.danger, fontSize: TYPE.body, fontWeight: '700' },
  pressed: { opacity: 0.62 },
});
