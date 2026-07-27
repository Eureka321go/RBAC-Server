import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { useAppStore } from '../store';

export function LoginScreen() {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const login = useAppStore((x) => x.login);
  const error = useAppStore((x) => x.error);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>IM 登录</Text>
      <TextInput
        style={styles.input}
        placeholder="用户名"
        autoCapitalize="none"
        value={u}
        onChangeText={setU}
      />
      <TextInput
        style={styles.input}
        placeholder="密码"
        secureTextEntry
        value={p}
        onChangeText={setP}
      />
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <Button title="登录" onPress={() => login(u, p)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12 },
  err: { color: '#dc2626' },
});
