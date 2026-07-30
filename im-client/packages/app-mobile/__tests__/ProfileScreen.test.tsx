import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ProfileScreen } from '../src/screens/ProfileScreen';

const mockLogout = jest.fn(async () => {});
const mockNavigate = jest.fn();
const mockStoreState = {
  myId: 10248,
  displayName: '林默',
  connState: 'connected',
  logout: mockLogout,
};

jest.mock('../src/store', () => ({
  useAppStore: (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
}));

jest.mock('../src/ui/ThemeProvider', () => {
  const { DARK_THEME: mockDarkTheme } = require('../src/ui/theme');
  return {
    useAppTheme: () => ({
      theme: mockDarkTheme,
      mode: 'dark',
      setMode: jest.fn(async () => {}),
      ready: true,
    }),
  };
});

jest.mock('../src/components/Avatar', () => ({ InitialAvatar: () => null }));
jest.mock('../src/components/AnimatedEntrance', () => ({
  AnimatedEntrance: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@react-native-vector-icons/ionicons/static', () => ({
  Ionicons: () => null,
}));
jest.mock('react-native-linear-gradient', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => children,
}));

test('shows scalable preference rows and opens appearance settings', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ProfileScreen
        navigation={{ navigate: mockNavigate } as never}
        route={{} as never}
      />,
    );
  });

  const appearance = renderer.root.findByProps({
    accessibilityLabel: '打开外观设置',
  });
  expect(appearance).toBeTruthy();
  expect(renderer.root.findByProps({ children: '深色' })).toBeTruthy();
  expect(
    renderer.root.findByProps({ accessibilityLabel: '语言，简体中文' }),
  ).toBeTruthy();
  await ReactTestRenderer.act(async () => {
    appearance.props.onPress();
  });
  expect(mockNavigate).toHaveBeenCalledWith('AppearanceSettings');
  expect(
    renderer.root.findByProps({ accessibilityLabel: '退出登录' }),
  ).toBeTruthy();
});
