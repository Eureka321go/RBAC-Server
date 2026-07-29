/**
 * IM app-mobile：登录 → 选人 → 会话 三屏。
 *
 * @format
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppStore } from './src/store';
import { LoginScreen } from './src/screens/LoginScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { ConversationsScreen } from './src/screens/ConversationsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { CreateGroupScreen } from './src/screens/CreateGroupScreen';
import { GroupDetailsScreen } from './src/screens/GroupDetailsScreen';
import { ConnectionStatusBar } from './src/components/ConnectionStatusBar';
import type { RootStackParamList } from './src/navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  const booted = useAppStore((x) => x.booted);
  const boot = useAppStore((x) => x.boot);
  const loggedIn = useAppStore((x) => x.loggedIn);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!booted) {
    return (
      <SafeAreaProvider>
        <View style={styles.center}>
          <Text>初始化本地数据库…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ConnectionStatusBar />
      <NavigationContainer>
        <Stack.Navigator>
          {!loggedIn ? (
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen
                name="Conversations"
                component={ConversationsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Contacts"
                component={ContactsScreen}
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
                name="GroupDetails"
                component={GroupDetailsScreen}
                options={{ headerShown: false }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default App;
