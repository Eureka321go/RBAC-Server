import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { GroupAvatar } from './Avatar';
import { AnimatedEntrance } from './AnimatedEntrance';
import { StatusNotice } from './StatusNotice';
import { SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

interface Props {
  error?: string | null;
}

export function BrandedLoadingState({ error }: Props) {
  const { theme } = useAppTheme();
  return (
    <LinearGradient
      colors={theme.isDark ? ['#0A0E1B', '#161B31'] : ['#F8FAFF', '#EAF0FF']}
      style={styles.page}
    >
      <View style={[styles.orb, styles.orbTop, { backgroundColor: theme.colors.primaryGlow }]} />
      <View style={[styles.orb, styles.orbBottom, { backgroundColor: theme.colors.primarySoft }]} />
      <AnimatedEntrance style={styles.content}>
        <GroupAvatar size={76} />
        <Text style={[styles.title, { color: theme.colors.text }]}>正在准备安全会话</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>初始化本地数据与消息连接…</Text>
        {error ? <StatusNotice message={error} tone="error" /> : null}
      </AnimatedEntrance>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  content: { width: '100%', maxWidth: 380, alignItems: 'center', padding: SPACING.xl },
  orb: { position: 'absolute', width: 260, height: 260, borderRadius: 130 },
  orbTop: { top: -100, right: -90 },
  orbBottom: { bottom: -120, left: -100 },
  title: { marginTop: SPACING.lg, fontSize: TYPE.title, fontWeight: '900' },
  subtitle: { marginTop: SPACING.xs, marginBottom: SPACING.lg, fontSize: TYPE.body },
});
