import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ProfileScreen } from '../src/screens/ProfileScreen';

const mockLogout = jest.fn(async () => {});
const mockSetMode = jest.fn(async () => {});
const mockStoreState = {
  myId: 10248,
  displayName: '林默',
  connState: 'connected',
  logout: mockLogout,
};

jest.mock('../src/store', () => ({
  useAppStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
}));

jest.mock('../src/ui/ThemeProvider', () => {
  const { DARK_THEME: mockDarkTheme } = require('../src/ui/theme');
  return {
    useAppTheme: () => ({
      theme: mockDarkTheme,
      mode: 'system',
      setMode: mockSetMode,
      ready: true,
    }),
  };
});

jest.mock('../src/components/Avatar', () => ({ InitialAvatar: () => null }));
jest.mock('../src/components/AnimatedEntrance', () => ({
  AnimatedEntrance: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@react-native-vector-icons/ionicons/static', () => ({ Ionicons: () => null }));
jest.mock('react-native-linear-gradient', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => children,
}));

test('offers all appearance choices and logout', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<ProfileScreen />);
  });

  expect(renderer.root.findByProps({ accessibilityLabel: '外观：跟随系统' })).toBeTruthy();
  expect(renderer.root.findByProps({ accessibilityLabel: '外观：浅色' })).toBeTruthy();
  expect(renderer.root.findByProps({ accessibilityLabel: '外观：深色' })).toBeTruthy();
  expect(renderer.root.findByProps({ accessibilityLabel: '退出登录' })).toBeTruthy();
});
