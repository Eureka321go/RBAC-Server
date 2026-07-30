import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadThemeMode,
  normalizeThemeMode,
  saveThemeMode,
  THEME_MODE_KEY,
} from '../src/ui/themePreference';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('theme preference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['system', 'system'],
    ['light', 'light'],
    ['dark', 'dark'],
    ['invalid', 'system'],
    ['', 'system'],
    [null, 'system'],
  ] as const)('normalizes %p to %p', (input, expected) => {
    expect(normalizeThemeMode(input)).toBe(expected);
  });

  test('loads and validates the stored mode', async () => {
    storage.getItem.mockResolvedValue('dark');

    await expect(loadThemeMode()).resolves.toBe('dark');
    expect(storage.getItem).toHaveBeenCalledWith(THEME_MODE_KEY);
  });

  test('falls back to system when storage fails', async () => {
    storage.getItem.mockRejectedValue(new Error('storage unavailable'));

    await expect(loadThemeMode()).resolves.toBe('system');
  });

  test('persists a valid mode', async () => {
    storage.setItem.mockResolvedValue(undefined);

    await expect(saveThemeMode('light')).resolves.toBeUndefined();
    expect(storage.setItem).toHaveBeenCalledWith(THEME_MODE_KEY, 'light');
  });

  test('does not block the app when persistence fails', async () => {
    storage.setItem.mockRejectedValue(new Error('disk full'));

    await expect(saveThemeMode('dark')).resolves.toBeUndefined();
  });
});
