import { DARK_THEME, LIGHT_THEME, resolveTheme } from '../src/ui/theme';

describe('app theme palettes', () => {
  test('exposes distinct readable light and dark semantic roles', () => {
    expect(LIGHT_THEME.isDark).toBe(false);
    expect(DARK_THEME.isDark).toBe(true);
    expect(LIGHT_THEME.colors.page).not.toBe(DARK_THEME.colors.page);
    expect(LIGHT_THEME.colors.text).not.toBe(LIGHT_THEME.colors.page);
    expect(DARK_THEME.colors.text).not.toBe(DARK_THEME.colors.page);
  });

  test('keeps both palettes structurally identical', () => {
    expect(Object.keys(DARK_THEME.colors).sort()).toEqual(
      Object.keys(LIGHT_THEME.colors).sort(),
    );
  });

  test.each([
    ['light', 'dark', false],
    ['dark', 'light', true],
    ['system', 'dark', true],
    ['system', 'light', false],
    ['system', null, false],
  ] as const)('resolves %s mode against %s system scheme', (mode, scheme, expectedDark) => {
    expect(resolveTheme(mode, scheme).isDark).toBe(expectedDark);
  });
});
