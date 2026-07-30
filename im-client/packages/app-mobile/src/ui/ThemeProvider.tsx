import React, {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { LIGHT_THEME, resolveTheme, type AppTheme } from './theme';
import {
  loadThemeMode,
  saveThemeMode,
  type ThemeMode,
} from './themePreference';

export interface AppThemeContextValue {
  theme: AppTheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => Promise<void>;
  ready: boolean;
}

const ThemeContext = createContext<AppThemeContextValue>({
  theme: LIGHT_THEME,
  mode: 'system',
  setMode: async () => {},
  ready: false,
});

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadThemeMode().then((storedMode) => {
      if (!active) return;
      setModeState(storedMode);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback(async (nextMode: ThemeMode) => {
    setModeState(nextMode);
    await saveThemeMode(nextMode);
  }, []);

  const value = useMemo<AppThemeContextValue>(() => ({
    theme: resolveTheme(mode, systemScheme),
    mode,
    setMode,
    ready,
  }), [mode, ready, setMode, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContextValue {
  return useContext(ThemeContext);
}
