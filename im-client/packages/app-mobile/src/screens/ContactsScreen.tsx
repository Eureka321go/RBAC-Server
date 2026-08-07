import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { AnimatedEntrance } from '../components/AnimatedEntrance';
import { DepartmentContactPicker } from '../components/DepartmentContactPicker';
import { PressableScale } from '../components/PressableScale';
import { RootScreenBackground } from '../components/RootScreenBackground';
import { StatusNotice } from '../components/StatusNotice';
import { Surface } from '../components/Surface';
import {
  buildContactDirectory,
  type ContactDirectoryModel,
} from '../contact/directory';
import type { RootTabScreenProps } from '../navigation/types';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
import { useLanguage } from '../ui/LanguageProvider';

type Props = RootTabScreenProps<'ContactsTab'>;

export function ContactsScreen({ navigation }: Props) {
  const myId = useAppStore(state => state.myId);
  const [directory, setDirectory] = useState<ContactDirectoryModel | null>(
    null,
  );
  const [hint, setHint] = useState<string | null>(null);
  const [openingPeerId, setOpeningPeerId] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const { theme } = useAppTheme();
  const { t } = useLanguage();

  const openChat = useCallback(
    async (peerId: number, peerName: string) => {
      if (
        myId == null ||
        peerId === myId ||
        !Number.isSafeInteger(peerId) ||
        peerId <= 0
      ) {
        setHint('无法打开该联系人。');
        return;
      }
      setOpeningPeerId(peerId);
      setHint('正在创建会话…');
      try {
        const cid = await sdk.sync.createSingleConversation(peerId);
        if (!mountedRef.current) return;
        setOpeningPeerId(null);
        navigation.navigate('Chat', {
          cid,
          title: peerName,
          conversationType: 'SINGLE',
          syncOnOpen: true,
        });
      } catch (cause) {
        if (!mountedRef.current) return;
        setHint(
          `创建会话失败：${cause instanceof Error ? cause.message : 'unknown'}`,
        );
        setOpeningPeerId(null);
      }
    },
    [myId, navigation],
  );

  useEffect(() => {
    mountedRef.current = true;
    void sdk.contacts
      .getDirectory()
      .then(result => {
        if (!mountedRef.current) return;
        setDirectory(buildContactDirectory(result));
        if (
          result.members.filter(member => member.userId !== myId).length === 0
        ) {
          setHint('暂无可聊天的组织联系人。');
        }
      })
      .catch(() => {
        if (mountedRef.current) setHint('拉取通讯录失败，请稍后重试。');
      });
    return () => {
      mountedRef.current = false;
    };
  }, [myId]);

  return (
    <RootScreenBackground>
      <View style={styles.content}>
        <AnimatedEntrance style={styles.heading}>
          <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>
            {t('contactsEyebrow')}
          </Text>
          <Text style={[styles.title, { color: theme.colors.text }]}>
            {t('contacts')}
          </Text>
        </AnimatedEntrance>

        <AnimatedEntrance index={1} style={styles.shortcuts}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('organization')}
            style={[
              styles.shortcut,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.shortcutIcon,
                { backgroundColor: theme.colors.primarySoft },
              ]}
            >
              <Ionicons
                name="git-network-outline"
                size={21}
                color={theme.colors.primary}
              />
            </View>
            <Text style={[styles.shortcutTitle, { color: theme.colors.text }]}>
              {t('organization')}
            </Text>
            <Text
              style={[styles.shortcutHint, { color: theme.colors.textMuted }]}
            >
              {t('findByDepartment')}
            </Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('groupChat')}
            onPress={() => navigation.navigate('CreateGroup')}
            style={[
              styles.shortcut,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.shortcutIcon,
                { backgroundColor: theme.colors.primarySoft },
              ]}
            >
              <Ionicons
                name="people-outline"
                size={21}
                color={theme.colors.primary}
              />
            </View>
            <Text style={[styles.shortcutTitle, { color: theme.colors.text }]}>
              {t('groupChat')}
            </Text>
            <Text
              style={[styles.shortcutHint, { color: theme.colors.textMuted }]}
            >
              {t('collaboration')}
            </Text>
          </PressableScale>
        </AnimatedEntrance>

        {hint ? (
          <StatusNotice
            message={hint}
            tone={hint.includes('失败') ? 'error' : 'warning'}
          />
        ) : null}

        <AnimatedEntrance index={2} style={styles.directorySection}>
          <View style={styles.directorySection}>
            <View style={styles.sectionHeading}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                {t('members')}
              </Text>
              <Text
                style={[styles.sectionMeta, { color: theme.colors.textMuted }]}
              >
                {t('selectContactToChat')}
              </Text>
            </View>
            {directory ? (
              <Surface style={styles.directory}>
                <DepartmentContactPicker
                  model={directory}
                  mode="single"
                  excludedIds={new Set(myId == null ? [] : [myId])}
                  disabled={openingPeerId != null}
                  onMemberPress={member =>
                    void openChat(member.userId, member.displayName)
                  }
                />
              </Surface>
            ) : (
              <Surface style={styles.loadingCard}>
                <Text
                  style={[
                    styles.loadingText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {t('loadingMembers')}
                </Text>
              </Surface>
            )}
          </View>
        </AnimatedEntrance>
      </View>
    </RootScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  heading: { paddingTop: SPACING.xs },
  eyebrow: { fontSize: TYPE.caption, fontWeight: '600' },
  title: {
    marginTop: 2,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  shortcuts: { flexDirection: 'row', gap: SPACING.sm },
  shortcut: {
    flex: 1,
    minWidth: 0,
    minHeight: 120,
    padding: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
  },
  shortcutIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutTitle: { marginTop: SPACING.sm, fontSize: 14, fontWeight: '800' },
  shortcutHint: { marginTop: 2, fontSize: 11 },
  sectionHeading: { marginBottom: SPACING.xs },
  sectionTitle: { fontSize: TYPE.subtitle, fontWeight: '800' },
  sectionMeta: { marginTop: 3, fontSize: TYPE.caption },
  directorySection: { flex: 1 },
  directory: { flex: 1 },
  loadingCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { fontSize: TYPE.body },
});
