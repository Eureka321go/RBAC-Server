/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState } from 'react-native';
import App from '../App';

const mockBoot = jest.fn(async () => {});
const mockAppState = {
  booted: true,
  loggedIn: false,
  myId: null as number | null,
  boot: mockBoot,
};
let mockNavigationContainerProps: Record<string, unknown> = {};

jest.mock('../src/push/pushPermission', () => ({
  reconcilePushRegistrationOnForeground: jest.fn(async () => undefined),
}));
jest.mock('../src/push/pushRegistration', () => ({ pushRegistration: {} }));
jest.mock('../src/push/nativePush', () => ({ nativePush: {} }));
jest.mock('../src/navigation/navigationRef', () => ({
  navigationRef: {isReady: jest.fn(() => false)},
}));
jest.mock('../src/push/PushCoordinator', () => ({
  PushCoordinator: ({navigationRevision}: {navigationRevision: number}) => {
    const ReactModule = require('react');
    const {View: NativeView} = require('react-native');
    return ReactModule.createElement(NativeView, {
      testID: 'push-coordinator',
      navigationRevision,
    });
  },
}));
const mockReconcilePushRegistrationOnForeground =
  require('../src/push/pushPermission')
    .reconcilePushRegistrationOnForeground as jest.Mock;
const mockNavigationRef =
  require('../src/navigation/navigationRef').navigationRef;

jest.mock('../src/store', () => ({
  useAppStore: (selector: (state: typeof mockAppState) => unknown) =>
    selector(mockAppState),
}));

jest.mock('../src/screens/LoginScreen', () => ({
  LoginScreen: () => {
    const ReactModule = require('react');
    const { View: NativeView } = require('react-native');
    return ReactModule.createElement(NativeView, { testID: 'login-screen' });
  },
}));
jest.mock('../src/screens/ContactsScreen', () => ({
  ContactsScreen: () => null,
}));
jest.mock('../src/screens/ConversationsScreen', () => ({
  ConversationsScreen: () => null,
}));
jest.mock('../src/screens/ChatScreen', () => ({ ChatScreen: () => null }));
jest.mock('../src/screens/CreateGroupScreen', () => ({
  CreateGroupScreen: () => null,
}));
jest.mock('../src/screens/ConversationSettingsScreen', () => ({
  ConversationSettingsScreen: () => null,
}));
jest.mock('../src/screens/GroupDetailsScreen', () => ({
  GroupDetailsScreen: () => null,
}));
jest.mock('../src/screens/AppearanceSettingsScreen', () => ({
  AppearanceSettingsScreen: () => null,
}));
jest.mock('../src/components/ConnectionStatusBar', () => ({
  ConnectionStatusBar: () => null,
}));
jest.mock('../src/navigation/RootTabs', () => ({ RootTabs: () => null }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => 'system'),
    setItem: jest.fn(async () => undefined),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: React.PropsWithChildren) => children,
}));

jest.mock('@react-navigation/native', () => ({
  DarkTheme: {
    dark: true,
    colors: {
      background: '#000000',
      card: '#000000',
      text: '#ffffff',
      border: '#333333',
      primary: '#8888ff',
      notification: '#ff0000',
    },
  },
  DefaultTheme: {
    dark: false,
    colors: {
      background: '#ffffff',
      card: '#ffffff',
      text: '#000000',
      border: '#dddddd',
      primary: '#0000ff',
      notification: '#ff0000',
    },
  },
  NavigationContainer: require('react').forwardRef(
    (
      {children, ...props}: React.PropsWithChildren,
      ref: React.ForwardedRef<unknown>,
    ) => {
      mockNavigationContainerProps = {...props, ref};
      return children;
    },
  ),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: React.PropsWithChildren) => children,
    Screen: ({ component: Component }: { component: React.ComponentType }) => {
      const ReactModule = require('react');
      return ReactModule.createElement(Component);
    },
  }),
}));

test('boots and renders the login route', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(mockBoot).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByProps({ testID: 'login-screen' })).toBeTruthy();
});

test('reconciles push registration when a logged-in app enters foreground', async () => {
  mockAppState.loggedIn = true;
  mockAppState.myId = 42;
  let onChange: ((state: string) => void) | undefined;
  const remove = jest.fn();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      onChange = listener as (state: string) => void;
      return { remove };
    });
  let renderer!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(async () => onChange?.('active'));

  expect(mockReconcilePushRegistrationOnForeground).toHaveBeenCalledWith(
    42,
    expect.anything(),
    expect.anything(),
  );
  await ReactTestRenderer.act(async () => renderer.unmount());
  expect(remove).toHaveBeenCalledTimes(1);
  mockAppState.loggedIn = false;
  mockAppState.myId = null;
});

test('wires navigation readiness and state changes into push flushing', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(mockNavigationContainerProps.ref).toBe(mockNavigationRef);
  expect(
    renderer.root.findByProps({testID: 'push-coordinator'}).props
      .navigationRevision,
  ).toBe(0);

  await ReactTestRenderer.act(async () => {
    (mockNavigationContainerProps.onReady as () => void)();
  });
  expect(
    renderer.root.findByProps({testID: 'push-coordinator'}).props
      .navigationRevision,
  ).toBe(1);

  await ReactTestRenderer.act(async () => {
    (mockNavigationContainerProps.onStateChange as () => void)();
  });
  expect(
    renderer.root.findByProps({testID: 'push-coordinator'}).props
      .navigationRevision,
  ).toBe(2);
});
