import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GroupAvatar } from '../components/Avatar';
import { AppButton } from '../components/AppButton';
import { AppTextField } from '../components/AppTextField';
import { StatusNotice } from '../components/StatusNotice';
import { Surface } from '../components/Surface';
import { useAppStore } from '../store';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

export function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const login = useAppStore((state) => state.login);
  const error = useAppStore((state) => state.error);

  const submit = async () => {
    if (username.trim() === '' || password === '' || submitting) return;
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <GroupAvatar size={76} />
          <Text style={styles.title}>欢迎回来</Text>
          <Text style={styles.subtitle}>登录后继续处理消息和群聊</Text>
        </View>

        <Surface style={styles.form}>
          <AppTextField
            label="用户名"
            placeholder="请输入用户名"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!submitting}
            value={username}
            onChangeText={setUsername}
          />
          <AppTextField
            label="密码"
            placeholder="请输入密码"
            secureTextEntry
            editable={!submitting}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
          />
          {error ? <StatusNotice message={error} tone="error" /> : null}
          <AppButton
            label={submitting ? '正在登录…' : '登录'}
            loading={submitting}
            disabled={username.trim() === '' || password === ''}
            onPress={() => void submit()}
          />
        </Surface>
        <Text style={styles.footnote}>安全连接 · 消息同步</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.page },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xxl,
    gap: SPACING.xl,
  },
  hero: { alignItems: 'center', gap: SPACING.xs },
  title: { color: COLORS.text, fontSize: TYPE.hero, fontWeight: '800', marginTop: SPACING.sm },
  subtitle: { color: COLORS.textSecondary, fontSize: TYPE.body },
  form: { padding: SPACING.lg, gap: SPACING.md, borderRadius: RADIUS.lg },
  footnote: { color: COLORS.textMuted, fontSize: TYPE.caption, textAlign: 'center' },
});
