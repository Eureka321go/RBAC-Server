import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_KEY = '@im/app-mobile/theme-mode';

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    return normalizeThemeMode(await AsyncStorage.getItem(THEME_MODE_KEY));
  } catch {
    return 'system';
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_MODE_KEY, mode);
  } catch {
    // Appearance is non-sensitive and non-blocking; the in-memory choice remains active.
  }
}
