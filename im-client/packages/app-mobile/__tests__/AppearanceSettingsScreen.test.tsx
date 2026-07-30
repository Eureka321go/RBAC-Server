import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppearanceSettingsScreen } from '../src/screens/AppearanceSettingsScreen';

const mockSetMode = jest.fn(async () => {});

jest.mock('../src/ui/ThemeProvider', () => {
  const { LIGHT_THEME: mockLightTheme } = require('../src/ui/theme');
  return {
    useAppTheme: () => ({
      theme: mockLightTheme,
      mode: 'system',
      setMode: mockSetMode,
      ready: true,
    }),
  };
});

jest.mock('@react-native-vector-icons/ionicons/static', () => ({
  Ionicons: () => null,
}));
jest.mock('react-native-linear-gradient', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => children,
}));

test('selects appearance from the dedicated settings screen', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <AppearanceSettingsScreen
        navigation={{ goBack: jest.fn() } as never}
        route={{} as never}
      />,
    );
  });

  expect(
    renderer.root.findByProps({ accessibilityLabel: '外观：跟随系统' }).props
      .accessibilityState,
  ).toMatchObject({ selected: true });
  const dark = renderer.root.findByProps({ accessibilityLabel: '外观：深色' });
  await ReactTestRenderer.act(async () => {
    dark.props.onPress();
  });
  expect(mockSetMode).toHaveBeenCalledWith('dark');
});
