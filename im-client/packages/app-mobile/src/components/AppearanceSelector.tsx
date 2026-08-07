import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Ionicons,
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons/static';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
import { useLanguage } from '../ui/LanguageProvider';
import type { ThemeMode } from '../ui/themePreference';
import { PressableScale } from './PressableScale';

export function AppearanceSelector() {
  const { theme, mode, setMode } = useAppTheme();
  const { t } = useLanguage();
  const appearanceOptions: ReadonlyArray<{ mode: ThemeMode; label: string; icon: IoniconsIconName }> = [
    { mode: 'system', label: t('followSystem'), icon: 'phone-portrait-outline' },
    { mode: 'light', label: t('light'), icon: 'sunny-outline' },
    { mode: 'dark', label: t('dark'), icon: 'moon-outline' },
  ];

  return (
    <View accessibilityRole="radiogroup" style={styles.list}>
      {appearanceOptions.map(option => {
        const selected = mode === option.mode;
        return (
          <PressableScale
            key={option.mode}
            accessibilityRole="radio"
            accessibilityLabel={`${t('appearance')}: ${option.label}`}
            accessibilityState={{ selected }}
            onPress={() => void setMode(option.mode)}
            style={[
              styles.option,
              {
                backgroundColor: selected
                  ? theme.colors.primarySoft
                  : theme.colors.surfaceMuted,
                borderColor: selected
                  ? theme.colors.primary
                  : theme.colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.icon,
                { backgroundColor: theme.colors.primarySoft },
              ]}
            >
              <Ionicons
                name={option.icon}
                size={21}
                color={
                  selected ? theme.colors.primary : theme.colors.textSecondary
                }
              />
            </View>
            <Text
              style={[
                styles.label,
                {
                  color: selected
                    ? theme.colors.primary
                    : theme.colors.textSecondary,
                },
              ]}
            >
              {option.label}
            </Text>
            {selected ? (
              <Ionicons
                name="checkmark-circle"
                size={23}
                color={theme.colors.primary}
              />
            ) : (
              <View
                style={[
                  styles.unselected,
                  { borderColor: theme.colors.borderStrong },
                ]}
              />
            )}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: SPACING.xs },
  option: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, fontSize: TYPE.body, fontWeight: '700' },
  unselected: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
});
