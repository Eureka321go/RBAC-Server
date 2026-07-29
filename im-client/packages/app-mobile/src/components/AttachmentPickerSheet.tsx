import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons/static';
import { IconButton } from './IconButton';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

type AttachmentKind = 'camera' | 'library' | 'file';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (kind: AttachmentKind) => void;
}

const ACTIONS: Array<{ kind: AttachmentKind; label: string; icon: IoniconsIconName }> = [
  { kind: 'camera', label: '拍照', icon: 'camera-outline' },
  { kind: 'library', label: '相册', icon: 'images-outline' },
  { kind: 'file', label: '文件', icon: 'document-attach-outline' },
];

export function AttachmentPickerSheet({ visible, onClose, onSelect }: Props) {
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
          accessibilityLabel="关闭附件选择"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>发送附件</Text>
            <IconButton name="close" accessibilityLabel="关闭" onPress={onClose} />
          </View>
          <View style={styles.actions}>
            {ACTIONS.map((action) => (
              <Pressable
                key={action.kind}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => onSelect(action.kind)}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name={action.icon} size={28} color={COLORS.primary} />
                </View>
                <Text style={styles.actionText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.overlay },
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
  actions: { flexDirection: 'row', gap: SPACING.lg, paddingVertical: SPACING.lg },
  action: { alignItems: 'center', gap: SPACING.xs },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  actionText: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '600' },
  pressed: { opacity: 0.62 },
});
