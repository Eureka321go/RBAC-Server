/**
 * IM app-mobile：M1 最小 App —— 登录 + WS 长连接状态条。
 *
 * @format
 */

import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from './src/store';
import { LoginScreen } from './src/screens/LoginScreen';
import { ConnectionStatusBar } from './src/components/ConnectionStatusBar';

function App() {
  const loggedIn = useAppStore((x) => x.loggedIn);
  const logout = useAppStore((x) => x.logout);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <ConnectionStatusBar />
        {loggedIn ? (
          <View style={styles.home}>
            <Text style={styles.hi}>已登录，WS 长连接已建立。</Text>
            <Button title="登出" onPress={() => logout()} />
          </View>
        ) : (
          <LoginScreen />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  home: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  hi: { fontSize: 16 },
});

export default App;
