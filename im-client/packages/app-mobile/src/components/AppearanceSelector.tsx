import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons/static';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
import type { ThemeMode } from '../ui/themePreference';
import { PressableScale } from './PressableScale';

const APPEARANCE_OPTIONS: ReadonlyArray<{
  mode: ThemeMode;
  label: string;
  icon: IoniconsIconName;
}> = [
  { mode: 'system', label: '跟随系统', icon: 'phone-portrait-outline' },
  { mode: 'light', label: '浅色', icon: 'sunny-outline' },
  { mode: 'dark', label: '深色', icon: 'moon-outline' },
];

export function AppearanceSelector() {
  const { theme, mode, setMode } = useAppTheme();

  return (
    <View style={styles.row}>
      {APPEARANCE_OPTIONS.map((option) => {
        const selected = mode === option.mode;
        return (
          <PressableScale
            key={option.mode}
            accessibilityRole="radio"
            accessibilityLabel={`外观：${option.label}`}
            accessibilityState={{ selected }}
            onPress={() => void setMode(option.mode)}
            style={[
              styles.option,
              {
                backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
              },
            ]}
          >
            <Ionicons
              name={option.icon}
              size={20}
              color={selected ? theme.colors.primary : theme.colors.textSecondary}
            />
            <Text
              style={[
                styles.label,
                { color: selected ? theme.colors.primary : theme.colors.textSecondary },
              ]}
            >
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: SPACING.xs },
  option: {
    flex: 1,
    minWidth: 0,
    height: 78,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.xxs,
  },
  label: { fontSize: TYPE.caption, fontWeight: '700' },
});
