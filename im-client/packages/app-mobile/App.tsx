/**
 * IM app-mobile：登录 → 选人 → 会话 三屏。
 *
 * @format
 */

import React, { useEffect, useMemo } from 'react';
import { AppState, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppStore } from './src/store';
import { LoginScreen } from './src/screens/LoginScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { CreateGroupScreen } from './src/screens/CreateGroupScreen';
import { ConversationSettingsScreen } from './src/screens/ConversationSettingsScreen';
import { GroupDetailsScreen } from './src/screens/GroupDetailsScreen';
import { AppearanceSettingsScreen } from './src/screens/AppearanceSettingsScreen';
import { ConnectionStatusBar } from './src/components/ConnectionStatusBar';
import type { RootStackParamList } from './src/navigation/types';
import { ThemeProvider, useAppTheme } from './src/ui/ThemeProvider';
import { RootTabs } from './src/navigation/RootTabs';
import { BrandedLoadingState } from './src/components/BrandedLoadingState';
import { reconcilePushRegistrationOnForeground } from './src/push/pushPermission';
import { pushRegistration } from './src/push/pushRegistration';
import { nativePush } from './src/push/nativePush';

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppContent() {
  const booted = useAppStore(x => x.booted);
  const boot = useAppStore(x => x.boot);
  const loggedIn = useAppStore(x => x.loggedIn);
  const myId = useAppStore(x => x.myId);
  const error = useAppStore(x => x.error);
  const { theme } = useAppTheme();
  const navigationTheme = useMemo(() => {
    const baseTheme = theme.isDark ? DarkTheme : DefaultTheme;
    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        background: theme.colors.page,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
        primary: theme.colors.primary,
      },
    };
  }, [theme]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (!loggedIn || myId == null) return undefined;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void reconcilePushRegistrationOnForeground(
          myId,
          pushRegistration,
          nativePush,
        );
      }
    });
    return () => subscription.remove();
  }, [loggedIn, myId]);

  if (!booted) {
    return <BrandedLoadingState error={error} />;
  }

  return (
    <>
      <StatusBar
        barStyle={theme.statusBarStyle}
        backgroundColor={theme.colors.surface}
      />
      {loggedIn ? <ConnectionStatusBar /> : null}
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator>
          {!loggedIn ? (
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false }}
            />
          ) : (
            <>
              <Stack.Screen
                name="Home"
                component={RootTabs}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AppearanceSettings"
                component={AppearanceSettingsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="CreateGroup"
                component={CreateGroupScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Chat"
                component={ChatScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ConversationSettings"
                component={ConversationSettingsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="GroupDetails"
                component={GroupDetailsScreen}
                options={{ headerShown: false }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
