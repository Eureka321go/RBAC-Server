import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppLanguage = 'zh-CN' | 'en-US';

export const APP_LANGUAGE_KEY = '@rayim/app-language';

export function normalizeLanguage(value: unknown): AppLanguage {
  return value === 'en-US' ? 'en-US' : 'zh-CN';
}

export async function loadLanguage(): Promise<AppLanguage> {
  try {
    return normalizeLanguage(await AsyncStorage.getItem(APP_LANGUAGE_KEY));
  } catch {
    return 'zh-CN';
  }
}

export async function saveLanguage(language: AppLanguage): Promise<void> {
  try {
    await AsyncStorage.setItem(APP_LANGUAGE_KEY, language);
  } catch {
    // Keep the selected language for this session if persistent storage is unavailable.
  }
}
