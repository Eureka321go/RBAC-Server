import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import {
  Ionicons,
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons/static';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConversationsScreen } from '../screens/ConversationsScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { useAppTheme } from '../ui/ThemeProvider';
import { useLanguage } from '../ui/LanguageProvider';
import type { RootTabParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();

function QuietTabButton(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      pressColor="transparent"
      pressOpacity={1}
      android_ripple={{ color: 'transparent', borderless: false }}
    />
  );
}

export const ROOT_TAB_ITEMS = [
  {
    name: 'ChatsTab',
    label: '聊天',
    icon: 'chatbubbles-outline',
    activeIcon: 'chatbubbles',
    component: ConversationsScreen,
  },
  {
    name: 'ContactsTab',
    label: '通讯录',
    icon: 'people-outline',
    activeIcon: 'people',
    component: ContactsScreen,
  },
  {
    name: 'ProfileTab',
    label: '我的',
    icon: 'person-circle-outline',
    activeIcon: 'person-circle',
    component: ProfileScreen,
  },
] as const;

function tabOptions(
  label: string,
  icon: IoniconsIconName,
  activeIcon: IoniconsIconName,
) {
  return {
    tabBarLabel: label,
    tabBarAccessibilityLabel: label,
    tabBarIcon: ({
      color,
      size,
      focused,
    }: {
      color: string;
      size: number;
      focused: boolean;
    }) => (
      <Ionicons name={focused ? activeIcon : icon} color={color} size={size} />
    ),
  };
}

export function RootTabs() {
  const { theme } = useAppTheme();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.page },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarButton: QuietTabButton,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        tabBarStyle: [
          styles.bar,
          {
            height: 64 + insets.bottom,
            paddingBottom: Math.max(insets.bottom, 8),
            backgroundColor: theme.colors.tabBar,
            borderTopColor: theme.colors.border,
          },
        ],
      }}
    >
      <Tab.Screen
        name="ChatsTab"
        component={ConversationsScreen}
        options={tabOptions(t('chats'), 'chatbubbles-outline', 'chatbubbles')}
      />
      <Tab.Screen
        name="ContactsTab"
        component={ContactsScreen}
        options={tabOptions(t('contacts'), 'people-outline', 'people')}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={tabOptions(t('profile'), 'person-circle-outline', 'person-circle')}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 7,
  },
  item: { minHeight: 52 },
  label: { fontSize: 11, fontWeight: '700' },
});
