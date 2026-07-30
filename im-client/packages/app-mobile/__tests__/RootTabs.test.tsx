import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { RootTabs, ROOT_TAB_ITEMS } from '../src/navigation/RootTabs';

let mockNavigatorProps: Record<string, unknown> | null = null;
const mockScreenProps: Array<Record<string, unknown>> = [];

jest.mock('../src/screens/ConversationsScreen', () => ({ ConversationsScreen: () => null }));
jest.mock('../src/screens/ContactsScreen', () => ({ ContactsScreen: () => null }));
jest.mock('../src/screens/ProfileScreen', () => ({ ProfileScreen: () => null }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: (props: Record<string, unknown>) => {
      mockNavigatorProps = props;
      return props.children;
    },
    Screen: (props: Record<string, unknown>) => {
      mockScreenProps.push(props);
      return null;
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 18, left: 0 }),
}));

jest.mock('../src/ui/ThemeProvider', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        page: '#fff', primary: '#66f', textMuted: '#777', tabBar: '#fff',
        border: '#ddd', shadow: '#000',
      },
    },
  }),
}));

jest.mock('@react-native-vector-icons/ionicons/static', () => ({
  Ionicons: () => null,
}));

test('declares the three authenticated tabs in product order', () => {
  expect(ROOT_TAB_ITEMS.map((item) => item.label)).toEqual(['聊天', '通讯录', '我的']);
  expect(ROOT_TAB_ITEMS.map((item) => item.name)).toEqual([
    'ChatsTab',
    'ContactsTab',
    'ProfileTab',
  ]);
});

test('renders all tabs with themed, safe-area-aware navigation options', async () => {
  mockNavigatorProps = null;
  mockScreenProps.length = 0;

  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<RootTabs />);
  });

  expect(mockScreenProps.map((props) => props.name)).toEqual([
    'ChatsTab',
    'ContactsTab',
    'ProfileTab',
  ]);
  expect(mockNavigatorProps).not.toBeNull();
  const navigatorProps = mockNavigatorProps as unknown as Record<string, unknown>;
  const screenOptions = navigatorProps.screenOptions as {
    tabBarStyle: Array<Record<string, unknown>>;
  };
  expect(screenOptions.tabBarStyle[1]).toMatchObject({ height: 82, paddingBottom: 18 });

  const firstOptions = mockScreenProps[0].options as {
    tabBarLabel: string;
    tabBarIcon: (props: { color: string; size: number; focused: boolean }) => React.ReactNode;
  };
  expect(firstOptions.tabBarLabel).toBe('聊天');
  expect(firstOptions.tabBarIcon({ color: '#66f', size: 24, focused: true })).toBeTruthy();
});
