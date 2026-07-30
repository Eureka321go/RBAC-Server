import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { AnimatedEntrance } from '../components/AnimatedEntrance';
import { AppButton } from '../components/AppButton';
import { AppTextField } from '../components/AppTextField';
import { DepartmentContactPicker } from '../components/DepartmentContactPicker';
import { PressableScale } from '../components/PressableScale';
import { StatusNotice } from '../components/StatusNotice';
import { Surface } from '../components/Surface';
import { buildContactDirectory, type ContactDirectoryModel } from '../contact/directory';
import type { RootTabScreenProps } from '../navigation/types';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

type Props = RootTabScreenProps<'ContactsTab'>;

export function ContactsScreen({ navigation }: Props) {
  const myId = useAppStore((state) => state.myId);
  const [directory, setDirectory] = useState<ContactDirectoryModel | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const [openingPeerId, setOpeningPeerId] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const scrollRef = useRef<ScrollView>(null);
  const directoryYRef = useRef(0);
  const { theme } = useAppTheme();

  const openChat = useCallback(async (peerId: number, peerName: string) => {
    if (myId == null || peerId === myId || !Number.isSafeInteger(peerId) || peerId <= 0) {
      setHint('请输入有效的对端 userId。');
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
      setHint(`创建会话失败：${cause instanceof Error ? cause.message : 'unknown'}`);
      setOpeningPeerId(null);
    }
  }, [myId, navigation]);

  useEffect(() => {
    mountedRef.current = true;
    void sdk.contacts.getDirectory().then((result) => {
      if (!mountedRef.current) return;
      setDirectory(buildContactDirectory(result));
      if (result.members.filter((member) => member.userId !== myId).length === 0) {
        setHint('没有可选联系人，可在下方直接输入对端 userId。');
      }
    }).catch(() => {
      if (mountedRef.current) setHint('拉取通讯录失败，请在下方直接输入对端 userId。');
    });
    return () => {
      mountedRef.current = false;
    };
  }, [myId]);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: theme.colors.page }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <AnimatedEntrance>
        <Text style={[styles.eyebrow, { color: theme.colors.textMuted }]}>快速找到团队里的每个人</Text>
        <Text style={[styles.title, { color: theme.colors.text }]}>通讯录</Text>
      </AnimatedEntrance>

      <AnimatedEntrance index={1} style={styles.shortcuts}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="浏览组织架构"
          onPress={() => scrollRef.current?.scrollTo({ y: directoryYRef.current, animated: true })}
          style={[styles.shortcut, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
        >
          <View style={[styles.shortcutIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="git-network-outline" size={21} color={theme.colors.primary} />
          </View>
          <Text style={[styles.shortcutTitle, { color: theme.colors.text }]}>组织架构</Text>
          <Text style={[styles.shortcutHint, { color: theme.colors.textMuted }]}>按部门查找</Text>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="发起群聊"
          onPress={() => navigation.navigate('CreateGroup')}
          style={[styles.shortcut, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
        >
          <View style={[styles.shortcutIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="people-outline" size={21} color={theme.colors.primary} />
          </View>
          <Text style={[styles.shortcutTitle, { color: theme.colors.text }]}>发起群聊</Text>
          <Text style={[styles.shortcutHint, { color: theme.colors.textMuted }]}>多人协作</Text>
        </PressableScale>
      </AnimatedEntrance>

      {hint ? <StatusNotice message={hint} tone={hint.includes('失败') ? 'error' : 'warning'} /> : null}

      <AnimatedEntrance index={2}>
        <View onLayout={(event) => { directoryYRef.current = event.nativeEvent.layout.y; }}>
        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>组织成员</Text>
          <Text style={[styles.sectionMeta, { color: theme.colors.textMuted }]}>选择联系人开始聊天</Text>
        </View>
        {directory ? (
          <Surface style={styles.directory}>
            <DepartmentContactPicker
              model={directory}
              mode="single"
              excludedIds={new Set(myId == null ? [] : [myId])}
              disabled={openingPeerId != null}
              onMemberPress={(member) => void openChat(member.userId, member.displayName)}
            />
          </Surface>
        ) : (
          <Surface style={styles.loadingCard}>
            <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>正在加载组织成员…</Text>
          </Surface>
        )}
        </View>
      </AnimatedEntrance>

      <AnimatedEntrance index={3}>
        <Surface style={styles.manual}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>通过 IM ID 查找</Text>
          <Text style={[styles.sectionMeta, { color: theme.colors.textSecondary }]}>联系人不在组织架构时仍可直接发起会话</Text>
          <AppTextField
            placeholder="输入对端 userId"
            keyboardType="number-pad"
            value={manualId}
            onChangeText={setManualId}
          />
          <AppButton
            label="进入会话"
            variant="secondary"
            disabled={openingPeerId != null || manualId.trim() === ''}
            onPress={() => void openChat(Number(manualId), `用户 ${manualId}`)}
          />
        </Surface>
      </AnimatedEntrance>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: 108,
    gap: SPACING.md,
  },
  eyebrow: { fontSize: TYPE.caption, fontWeight: '600' },
  title: { marginTop: 2, fontSize: 30, lineHeight: 38, fontWeight: '900', letterSpacing: -0.8 },
  shortcuts: { flexDirection: 'row', gap: SPACING.sm },
  shortcut: {
    flex: 1,
    minWidth: 0,
    minHeight: 120,
    padding: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
  },
  shortcutIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  shortcutTitle: { marginTop: SPACING.sm, fontSize: 14, fontWeight: '800' },
  shortcutHint: { marginTop: 2, fontSize: 11 },
  sectionHeading: { marginBottom: SPACING.xs },
  sectionTitle: { fontSize: TYPE.subtitle, fontWeight: '800' },
  sectionMeta: { marginTop: 3, fontSize: TYPE.caption },
  directory: { minHeight: 300, maxHeight: 460 },
  loadingCard: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: TYPE.body },
  manual: { padding: SPACING.md, gap: SPACING.sm },
});
