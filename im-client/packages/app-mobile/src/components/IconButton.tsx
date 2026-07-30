import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons/static';
import { RADIUS } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
import { PressableScale } from './PressableScale';

interface Props {
  name: IoniconsIconName;
  accessibilityLabel: string;
  onPress: () => void;
  color?: string;
  backgroundColor?: string;
  size?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  name,
  accessibilityLabel,
  onPress,
  color,
  backgroundColor = 'transparent',
  size = 22,
  disabled = false,
  style,
}: Props) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={color ?? theme.colors.text} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
});
