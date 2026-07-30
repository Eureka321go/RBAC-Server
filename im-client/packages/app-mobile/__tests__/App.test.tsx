/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

const mockBoot = jest.fn(async () => {});
const mockAppState = {
  booted: true,
  loggedIn: false,
  boot: mockBoot,
};

jest.mock('../src/store', () => ({
  useAppStore: (selector: (state: typeof mockAppState) => unknown) => selector(mockAppState),
}));

jest.mock('../src/screens/LoginScreen', () => ({
  LoginScreen: () => {
    const ReactModule = require('react');
    const { View: NativeView } = require('react-native');
    return ReactModule.createElement(NativeView, { testID: 'login-screen' });
  },
}));
jest.mock('../src/screens/ContactsScreen', () => ({ ContactsScreen: () => null }));
jest.mock('../src/screens/ConversationsScreen', () => ({ ConversationsScreen: () => null }));
jest.mock('../src/screens/ChatScreen', () => ({ ChatScreen: () => null }));
jest.mock('../src/screens/CreateGroupScreen', () => ({ CreateGroupScreen: () => null }));
jest.mock('../src/screens/ConversationSettingsScreen', () => ({
  ConversationSettingsScreen: () => null,
}));
jest.mock('../src/screens/GroupDetailsScreen', () => ({ GroupDetailsScreen: () => null }));
jest.mock('../src/components/ConnectionStatusBar', () => ({ ConnectionStatusBar: () => null }));
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
      background: '#000000', card: '#000000', text: '#ffffff',
      border: '#333333', primary: '#8888ff', notification: '#ff0000',
    },
  },
  DefaultTheme: {
    dark: false,
    colors: {
      background: '#ffffff', card: '#ffffff', text: '#000000',
      border: '#dddddd', primary: '#0000ff', notification: '#ff0000',
    },
  },
  NavigationContainer: ({ children }: React.PropsWithChildren) => children,
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
