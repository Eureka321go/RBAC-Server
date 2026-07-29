import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons/static';
import { COLORS, SPACING, TYPE } from '../ui/theme';

interface Props {
  title: string;
  onBack: () => void;
  rightLabel?: string;
  rightIcon?: IoniconsIconName;
  rightAccessibilityLabel?: string;
  onRightPress?: () => void;
}

/** 替代 Android edge-to-edge 下过高的 native-stack Header。 */
export function CompactScreenHeader({
  title,
  onBack,
  rightLabel,
  rightIcon,
  rightAccessibilityLabel,
  onRightPress,
}: Props) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="返回"
        hitSlop={8}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        onPress={onBack}
      >
        <Ionicons name="chevron-back" size={28} color={COLORS.text} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {(rightLabel || rightIcon) && onRightPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rightAccessibilityLabel ?? rightLabel}
          hitSlop={8}
          style={({ pressed }) => [styles.right, pressed && styles.pressed]}
          onPress={onRightPress}
        >
          {rightIcon ? <Ionicons name={rightIcon} size={23} color={COLORS.primary} /> : null}
          {rightLabel ? <Text style={styles.rightText}>{rightLabel}</Text> : null}
        </Pressable>
      ) : (
        <View style={styles.balance} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 58,
    paddingHorizontal: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: COLORS.surfaceMuted },
  title: {
    flex: 1,
    textAlign: 'center',
    color: COLORS.text,
    fontSize: TYPE.subtitle,
    fontWeight: '700',
  },
  balance: { width: 44 },
  right: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
});
