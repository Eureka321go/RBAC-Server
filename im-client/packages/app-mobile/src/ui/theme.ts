import type { ColorSchemeName } from 'react-native';
import type { ThemeMode } from './themePreference';

export interface ThemeColors {
  page: string;
  pageAccent: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  primaryGlow: string;
  mention: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  messageMine: string;
  messageOther: string;
  voiceWavePlayed: string;
  voiceWaveIdle: string;
  voiceUnread: string;
  recordingOverlay: string;
  overlay: string;
  white: string;
  tabBar: string;
  shadow: string;
}

export interface AppTheme {
  isDark: boolean;
  colors: ThemeColors;
  statusBarStyle: 'light-content' | 'dark-content';
}

export const LIGHT_THEME: AppTheme = {
  isDark: false,
  statusBarStyle: 'dark-content',
  colors: {
    page: '#F3F6FF',
    pageAccent: '#E8EEFF',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceMuted: '#F7F9FF',
    primary: '#5272EF',
    primaryPressed: '#405DCE',
    primarySoft: '#E8EEFF',
    primaryGlow: 'rgba(82, 114, 239, 0.24)',
    mention: '#5272EF',
    text: '#151B2B',
    textSecondary: '#5F6B84',
    textMuted: '#8994AA',
    border: '#E3E8F4',
    borderStrong: '#CBD4E5',
    success: '#16946A',
    successSoft: '#E5F7F0',
    warning: '#B46A08',
    warningSoft: '#FFF4DE',
    danger: '#D94255',
    dangerSoft: '#FFECEF',
    messageMine: '#DDE5FF',
    messageOther: '#FFFFFF',
    voiceWavePlayed: '#5272EF',
    voiceWaveIdle: '#8994AA',
    voiceUnread: '#D94255',
    recordingOverlay: 'rgba(14, 20, 36, 0.90)',
    overlay: 'rgba(14, 20, 36, 0.38)',
    white: '#FFFFFF',
    tabBar: 'rgba(255, 255, 255, 0.96)',
    shadow: '#35466F',
  },
};

export const DARK_THEME: AppTheme = {
  isDark: true,
  statusBarStyle: 'light-content',
  colors: {
    page: '#0A0E1B',
    pageAccent: '#11182A',
    surface: '#151C2D',
    surfaceElevated: '#1B2438',
    surfaceMuted: '#111827',
    primary: '#B188FF',
    primaryPressed: '#9870E8',
    primarySoft: 'rgba(177, 136, 255, 0.14)',
    primaryGlow: 'rgba(177, 136, 255, 0.30)',
    mention: '#BFA0FF',
    text: '#F2F4FF',
    textSecondary: '#A7B0C7',
    textMuted: '#77829D',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    success: '#63D8B3',
    successSoft: 'rgba(99, 216, 179, 0.12)',
    warning: '#F2B65F',
    warningSoft: 'rgba(242, 182, 95, 0.12)',
    danger: '#FF758A',
    dangerSoft: 'rgba(255, 117, 138, 0.12)',
    messageMine: '#735CDA',
    messageOther: '#1B2438',
    voiceWavePlayed: '#B188FF',
    voiceWaveIdle: '#77829D',
    voiceUnread: '#FF758A',
    recordingOverlay: 'rgba(5, 8, 17, 0.94)',
    overlay: 'rgba(3, 6, 14, 0.64)',
    white: '#FFFFFF',
    tabBar: 'rgba(25, 33, 52, 0.97)',
    shadow: '#000000',
  },
};

export function resolveTheme(
  mode: ThemeMode,
  systemScheme: ColorSchemeName | null | undefined,
): AppTheme {
  const useDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  return useDark ? DARK_THEME : LIGHT_THEME;
}

/** @deprecated Migrate components to `useAppTheme().theme.colors`. */
export const COLORS = LIGHT_THEME.colors;

export const SPACING = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const TYPE = {
  caption: 12,
  body: 15,
  subtitle: 17,
  title: 22,
  hero: 28,
} as const;
