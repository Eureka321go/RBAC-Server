import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { IconButton } from './IconButton';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

interface Props {
  visible: boolean;
  canQuote: boolean;
  canRecall: boolean;
  onClose: () => void;
  onQuote: () => void;
  onRecall: () => void;
}

/** 受控消息操作面板；业务权限和 SDK 调用由所属页面负责。 */
export function MessageActionSheet({
  visible,
  canQuote,
  canRecall,
  onClose,
  onQuote,
  onRecall,
}: Props) {
  const { theme } = useAppTheme();
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭消息操作"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <Text style={[styles.title, { color: theme.colors.text }]}>消息操作</Text>
            <IconButton name="close" accessibilityLabel="关闭" onPress={onClose} />
          </View>
          {canQuote ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="引用消息"
              onPress={onQuote}
              style={({ pressed }) => [
                styles.action,
                { borderBottomColor: theme.colors.border },
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.actionIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="return-up-back-outline" size={21} color={theme.colors.primary} />
              </View>
              <Text style={[styles.actionText, { color: theme.colors.primary }]}>引用</Text>
            </Pressable>
          ) : null}
          {canRecall ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="撤回消息"
              onPress={onRecall}
              style={({ pressed }) => [
                styles.action,
                { borderBottomColor: theme.colors.border },
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.actionIcon, { backgroundColor: theme.colors.dangerSoft }]}>
                <Ionicons name="arrow-undo-outline" size={21} color={theme.colors.danger} />
              </View>
              <Text style={[styles.actionText, { color: theme.colors.danger }]}>撤回</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: TYPE.subtitle, fontWeight: '800' },
  action: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: TYPE.body, fontWeight: '700' },
  pressed: { opacity: 0.62 },
});
