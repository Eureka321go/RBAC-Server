import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons/static';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
import { PressableScale } from './PressableScale';

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
  const { theme } = useAppTheme();
  const { colors } = theme;
  const unavailable = disabled || loading;
  const textColor = variant === 'primary'
    ? colors.white
    : variant === 'danger'
      ? colors.danger
      : colors.primary;
  const variantStyle: ViewStyle = variant === 'secondary'
    ? { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1 }
    : variant === 'danger'
      ? { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 1 }
      : variant === 'ghost'
        ? { backgroundColor: 'transparent' }
        : { backgroundColor: colors.primary };
  const labelStyle: TextStyle = { color: textColor };

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      style={[styles.base, variantStyle, unavailable && styles.disabled, style]}
    >
      {variant === 'primary' ? (
        <LinearGradient
          pointerEvents="none"
          colors={theme.isDark ? ['#765CFF', '#A86EFF'] : ['#5272EF', '#7B6AF5']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        />
      ) : null}
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : icon ? (
        <Ionicons name={icon} size={19} color={textColor} />
      ) : null}
      <Text style={[styles.label, labelStyle]}>{label}</Text>
    </PressableScale>
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
    overflow: 'hidden',
  },
  gradient: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: RADIUS.md,
  },
  label: { fontSize: TYPE.body, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
