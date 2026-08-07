import React, { useEffect, useState } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Ionicons,
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons/static';
import { InitialAvatar } from '../components/Avatar';
import { AppButton } from '../components/AppButton';
import { AnimatedEntrance } from '../components/AnimatedEntrance';
import { PresenceDot } from '../components/PresenceDot';
import { RootScreenBackground } from '../components/RootScreenBackground';
import { Surface } from '../components/Surface';
import type { RootTabScreenProps } from '../navigation/types';
import { useAppStore } from '../store';
import { SPACING, TYPE } from '../ui/theme';
import type { ThemeMode } from '../ui/themePreference';
import { useAppTheme } from '../ui/ThemeProvider';
import { nativePush } from '../push/nativePush';
import { useLanguage } from '../ui/LanguageProvider';

interface PreferenceRowProps {
  icon: IoniconsIconName;
  label: string;
  value: string;
  accessibilityLabel: string;
  onPress: () => void;
  showDivider?: boolean;
}

function PreferenceRow({
  icon,
  label,
  value,
  accessibilityLabel,
  onPress,
  showDivider = false,
}: PreferenceRowProps) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.preferenceRow,
        showDivider && {
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        pressed && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <View
        style={[
          styles.preferenceIcon,
          { backgroundColor: theme.colors.primarySoft },
        ]}
      >
        <Ionicons name={icon} size={20} color={theme.colors.primary} />
      </View>
      <Text style={[styles.preferenceLabel, { color: theme.colors.text }]}>
        {label}
      </Text>
      <Text
        style={[styles.preferenceValue, { color: theme.colors.textSecondary }]}
      >
        {value}
      </Text>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={theme.colors.textMuted}
      />
    </Pressable>
  );
}

type Props = RootTabScreenProps<'ProfileTab'>;

export function ProfileScreen({ navigation }: Props) {
  const myId = useAppStore(state => state.myId);
  const displayName = useAppStore(state => state.displayName);
  const connState = useAppStore(state => state.connState);
  const logout = useAppStore(state => state.logout);
  const { theme, mode } = useAppTheme();
  const { language, t } = useLanguage();
  const appearanceLabels: Record<ThemeMode, string> = {
    system: t('followSystem'), light: t('light'), dark: t('dark'),
  };
  const connectionLabels: Record<string, string> = {
    connected: t('online'), connecting: t('connecting'),
    reconnecting: t('reconnecting'), closed: t('offline'),
  };
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void nativePush.areNotificationsEnabled().then(enabled => {
        if (mounted) setNotificationsEnabled(enabled);
      });
    };
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  const statusColor =
    connState === 'connected'
      ? theme.colors.success
      : connState === 'closed'
      ? theme.colors.danger
      : theme.colors.warning;

  return (
    <RootScreenBackground>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <AnimatedEntrance style={styles.heading}>
          <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>
            {t('workspaceAndPreferences')}
          </Text>
          <Text style={[styles.title, { color: theme.colors.text }]}>{t('profile')}</Text>
        </AnimatedEntrance>

        <AnimatedEntrance index={1}>
          <Surface style={styles.identityCard}>
            <InitialAvatar name={displayName} userId={myId} size={56} />
            <View style={styles.identityText}>
              <Text style={[styles.name, { color: theme.colors.text }]}>
                {displayName || `${t('user')} #${myId ?? ''}`}
              </Text>
              <Text style={[styles.id, { color: theme.colors.textSecondary }]}>
                IM ID · {myId ?? '—'}
              </Text>
              <View style={styles.statusLine}>
                <PresenceDot
                  color={statusColor}
                  pulse={
                    connState === 'connecting' || connState === 'reconnecting'
                  }
                />
                <Text style={[styles.status, { color: statusColor }]}>
                  {connectionLabels[connState] ?? connState}
                </Text>
              </View>
            </View>
          </Surface>
        </AnimatedEntrance>

        <AnimatedEntrance index={2}>
          <Surface style={styles.preferences}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
              {t('preferences')}
            </Text>
            <PreferenceRow
              icon="color-palette-outline"
              label={t('appearance')}
              value={appearanceLabels[mode]}
              accessibilityLabel={t('appearance')}
              onPress={() => navigation.navigate('AppearanceSettings')}
            />
            <PreferenceRow
              icon="notifications-outline"
              label={t('notification')}
              value={notificationsEnabled ? t('enabled') : t('disabled')}
              accessibilityLabel={t('notification')}
              onPress={() => void Linking.openSettings().catch(() => {})}
              showDivider
            />
            <PreferenceRow
              icon="language-outline"
              label={t('language')}
              value={language === 'zh-CN' ? t('simplifiedChinese') : t('english')}
              accessibilityLabel={t('language')}
              onPress={() => navigation.navigate('LanguageSettings')}
              showDivider
            />
          </Surface>
        </AnimatedEntrance>

        <AnimatedEntrance index={3}>
          <AppButton
            label={t('logout')}
            icon="log-out-outline"
            variant="danger"
            onPress={() => void logout()}
          />
        </AnimatedEntrance>
      </ScrollView>
    </RootScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  heading: { paddingTop: SPACING.xs },
  eyebrow: { fontSize: TYPE.caption, fontWeight: '600' },
  title: {
    marginTop: SPACING.xxs,
    fontSize: TYPE.hero,
    lineHeight: 36,
    fontWeight: '900',
  },
  identityCard: {
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    overflow: 'hidden',
  },
  identityText: { flex: 1, minWidth: 0 },
  name: { fontSize: TYPE.subtitle, fontWeight: '800' },
  id: { marginTop: SPACING.xxs, fontSize: TYPE.caption },
  statusLine: {
    marginTop: SPACING.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  status: { fontSize: 11, fontWeight: '700' },
  preferences: { paddingTop: SPACING.md },
  sectionTitle: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xs,
    fontSize: TYPE.subtitle,
    fontWeight: '800',
  },
  preferenceRow: {
    minHeight: 64,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  preferenceIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preferenceLabel: { flex: 1, fontSize: TYPE.body, fontWeight: '700' },
  preferenceValue: { fontSize: TYPE.caption },
});
