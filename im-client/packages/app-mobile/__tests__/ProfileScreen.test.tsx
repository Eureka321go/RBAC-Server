import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState, Linking } from 'react-native';
import { ProfileScreen } from '../src/screens/ProfileScreen';

jest.mock('../src/push/nativePush', () => ({
  nativePush: { areNotificationsEnabled: jest.fn(async () => true) },
}));
const mockAreNotificationsEnabled = require('../src/push/nativePush').nativePush
  .areNotificationsEnabled as jest.Mock;

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
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
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
  const notifications = renderer.root.findByProps({
    accessibilityLabel: '打开系统通知设置',
  });
  expect(renderer.root.findByProps({ children: '已开启' })).toBeTruthy();
  await ReactTestRenderer.act(async () => {
    appearance.props.onPress();
  });
  expect(mockNavigate).toHaveBeenCalledWith('AppearanceSettings');
  await ReactTestRenderer.act(async () => notifications.props.onPress());
  expect(openSettings).toHaveBeenCalledTimes(1);
  expect(
    renderer.root.findByProps({ accessibilityLabel: '退出登录' }),
  ).toBeTruthy();
});

test('refreshes notification state on foreground without updating after unmount', async () => {
  let onChange: ((state: string) => void) | undefined;
  const remove = jest.fn();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      onChange = listener as (state: string) => void;
      return { remove };
    });
  mockAreNotificationsEnabled.mockResolvedValue(false);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ProfileScreen
        navigation={{ navigate: mockNavigate } as never}
        route={{} as never}
      />,
    );
  });
  expect(renderer.root.findByProps({ children: '已关闭' })).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer.unmount());
  expect(remove).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => onChange?.('active'));
});
