import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons/static';
import { SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

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
  const { theme } = useAppTheme();
  const { colors } = theme;
  return (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="返回"
        hitSlop={8}
        style={({ pressed }) => [
          styles.back,
          pressed && { backgroundColor: colors.surfaceMuted },
        ]}
        onPress={onBack}
      >
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </Pressable>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{title}</Text>
      {(rightLabel || rightIcon) && onRightPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rightAccessibilityLabel ?? rightLabel}
          hitSlop={8}
          style={({ pressed }) => [
            styles.right,
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
          onPress={onRightPress}
        >
          {rightIcon ? <Ionicons name={rightIcon} size={23} color={colors.primary} /> : null}
          {rightLabel ? <Text style={[styles.rightText, { color: colors.primary }]}>{rightLabel}</Text> : null}
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
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
  rightText: { fontSize: 14, fontWeight: '600' },
});
