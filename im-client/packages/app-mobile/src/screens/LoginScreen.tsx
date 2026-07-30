import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { AnimatedEntrance } from '../components/AnimatedEntrance';
import { GroupAvatar } from '../components/Avatar';
import { AppButton } from '../components/AppButton';
import { AppTextField } from '../components/AppTextField';
import { StatusNotice } from '../components/StatusNotice';
import { Surface } from '../components/Surface';
import { useAppStore } from '../store';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

export function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const login = useAppStore((state) => state.login);
  const error = useAppStore((state) => state.error);
  const { theme } = useAppTheme();

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
    <LinearGradient
      colors={theme.isDark ? ['#0A0E1B', '#161B31'] : ['#F9FAFF', '#EAF0FF']}
      style={styles.page}
    >
      <View style={[styles.orb, styles.orbTop, { backgroundColor: theme.colors.primaryGlow }]} />
      <View style={[styles.orb, styles.orbBottom, { backgroundColor: theme.colors.primarySoft }]} />
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AnimatedEntrance style={styles.hero}>
            <GroupAvatar size={78} />
            <Text style={[styles.kicker, { color: theme.colors.primary }]}>SECURE WORKSPACE</Text>
            <Text style={[styles.title, { color: theme.colors.text }]}>欢迎回来</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>登录后继续处理消息和群聊</Text>
          </AnimatedEntrance>

          <AnimatedEntrance index={1}>
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
          </AnimatedEntrance>
          <Text style={[styles.footnote, { color: theme.colors.textMuted }]}>端到端安全连接 · 多端消息同步</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xxl,
    gap: SPACING.xl,
  },
  orb: { position: 'absolute', width: 280, height: 280, borderRadius: 140 },
  orbTop: { top: -120, right: -100 },
  orbBottom: { bottom: -150, left: -110 },
  hero: { alignItems: 'center' },
  kicker: { marginTop: SPACING.md, fontSize: 10, fontWeight: '900', letterSpacing: 1.6 },
  title: { marginTop: SPACING.xs, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
  subtitle: { marginTop: SPACING.xs, fontSize: TYPE.body },
  form: { padding: SPACING.lg, gap: SPACING.md, borderRadius: RADIUS.xl },
  footnote: { fontSize: TYPE.caption, textAlign: 'center' },
});
