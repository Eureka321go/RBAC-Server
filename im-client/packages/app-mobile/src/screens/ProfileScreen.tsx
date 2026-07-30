import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { InitialAvatar } from '../components/Avatar';
import { AppButton } from '../components/AppButton';
import { AppearanceSelector } from '../components/AppearanceSelector';
import { AnimatedEntrance } from '../components/AnimatedEntrance';
import { PresenceDot } from '../components/PresenceDot';
import { Surface } from '../components/Surface';
import { useAppStore } from '../store';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

const CONNECTION_LABELS: Record<string, string> = {
  connected: '在线',
  connecting: '连接中',
  reconnecting: '重连中',
  closed: '离线',
};

export function ProfileScreen() {
  const myId = useAppStore((state) => state.myId);
  const displayName = useAppStore((state) => state.displayName);
  const connState = useAppStore((state) => state.connState);
  const logout = useAppStore((state) => state.logout);
  const { theme } = useAppTheme();
  const statusColor = connState === 'connected'
    ? theme.colors.success
    : connState === 'closed'
      ? theme.colors.danger
      : theme.colors.warning;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.page }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <AnimatedEntrance>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>工作空间与个人偏好</Text>
        <Text style={[styles.title, { color: theme.colors.text }]}>我的</Text>
      </AnimatedEntrance>

      <AnimatedEntrance index={1}>
        <LinearGradient
          colors={theme.isDark ? ['#242044', '#18283C'] : ['#F4F6FF', '#E9F3FF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.identityCard, { borderColor: theme.colors.border }]}
        >
          <InitialAvatar name={displayName} userId={myId} size={62} />
          <View style={styles.identityText}>
            <Text style={[styles.name, { color: theme.colors.text }]}>
              {displayName || `用户 #${myId ?? ''}`}
            </Text>
            <Text style={[styles.id, { color: theme.colors.textSecondary }]}>IM ID · {myId ?? '—'}</Text>
            <View style={styles.statusLine}>
              <PresenceDot
                color={statusColor}
                pulse={connState === 'connecting' || connState === 'reconnecting'}
              />
              <Text style={[styles.status, { color: statusColor }]}>
                {CONNECTION_LABELS[connState] ?? connState}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </AnimatedEntrance>

      <AnimatedEntrance index={2}>
        <Surface style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>外观</Text>
          <Text style={[styles.sectionHint, { color: theme.colors.textSecondary }]}>选择更适合当前环境的界面</Text>
          <AppearanceSelector />
        </Surface>
      </AnimatedEntrance>

      <AnimatedEntrance index={3}>
        <AppButton
          label="退出登录"
          icon="log-out-outline"
          variant="danger"
          onPress={() => void logout()}
        />
      </AnimatedEntrance>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: 108,
    gap: SPACING.md,
  },
  eyebrow: { fontSize: TYPE.caption, fontWeight: '600' },
  title: { marginTop: SPACING.xxs, fontSize: TYPE.hero, lineHeight: 36, fontWeight: '900' },
  identityCard: {
    padding: SPACING.lg,
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    overflow: 'hidden',
  },
  identityText: { flex: 1, minWidth: 0 },
  name: { fontSize: TYPE.subtitle, fontWeight: '800' },
  id: { marginTop: SPACING.xxs, fontSize: TYPE.caption },
  statusLine: { marginTop: SPACING.xs, flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { fontSize: 11, fontWeight: '700' },
  section: { padding: SPACING.md, gap: SPACING.xs },
  sectionTitle: { fontSize: TYPE.subtitle, fontWeight: '800' },
  sectionHint: { marginBottom: SPACING.xs, fontSize: TYPE.caption },
});
