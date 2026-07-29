import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons/static';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IoniconsIconName;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  style,
}: Props) {
  const selected = variantStyles[variant];
  const unavailable = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        selected.button,
        pressed && !unavailable && styles.pressed,
        unavailable && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={selected.spinner} />
      ) : icon ? (
        <Ionicons name={icon} size={19} color={selected.text.color} />
      ) : null}
      <Text style={[styles.label, selected.text]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  label: { fontSize: TYPE.body, fontWeight: '700' },
  primary: { backgroundColor: COLORS.primary },
  primaryText: { color: COLORS.white },
  secondary: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderStrong },
  secondaryText: { color: COLORS.primary },
  ghost: { backgroundColor: 'transparent' },
  ghostText: { color: COLORS.primary },
  danger: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: '#F3C5C5' },
  dangerText: { color: COLORS.danger },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.45 },
});

const variantStyles = {
  primary: { button: styles.primary, text: styles.primaryText, spinner: COLORS.white },
  secondary: { button: styles.secondary, text: styles.secondaryText, spinner: COLORS.primary },
  ghost: { button: styles.ghost, text: styles.ghostText, spinner: COLORS.primary },
  danger: { button: styles.danger, text: styles.dangerText, spinner: COLORS.danger },
} as const;
