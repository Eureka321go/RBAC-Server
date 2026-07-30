import { ROOT_TAB_ITEMS } from '../src/navigation/RootTabs';

jest.mock('../src/screens/ConversationsScreen', () => ({ ConversationsScreen: () => null }));
jest.mock('../src/screens/ContactsScreen', () => ({ ContactsScreen: () => null }));
jest.mock('../src/screens/ProfileScreen', () => ({ ProfileScreen: () => null }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: () => null,
    Screen: () => null,
  }),
}));

test('declares the three authenticated tabs in product order', () => {
  expect(ROOT_TAB_ITEMS.map((item) => item.label)).toEqual(['聊天', '通讯录', '我的']);
  expect(ROOT_TAB_ITEMS.map((item) => item.name)).toEqual([
    'ChatsTab',
    'ContactsTab',
    'ProfileTab',
  ]);
});
