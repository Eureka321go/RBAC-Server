import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import type { ConversationRow } from '@im/sdk-core';
import { InitialAvatar } from '../components/Avatar';
import { ConversationRowView } from '../components/ConversationRowView';
import { IconButton } from '../components/IconButton';
import { PresenceDot } from '../components/PresenceDot';
import { StatusNotice } from '../components/StatusNotice';
import { RootScreenBackground } from '../components/RootScreenBackground';
import { formatConversationTime } from '../conversation/conversationTime';
import type { RootTabScreenProps } from '../navigation/types';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

type Props = RootTabScreenProps<'ChatsTab'>;

function titleOf(row: ConversationRow, myId: number | null): string {
  const displayName = row.displayName?.trim();
  if (displayName) return displayName;
  if (row.type === 'GROUP') return `群聊 #${row.groupId ?? row.cid.slice(2)}`;
  const peerName = row.peerName?.trim();
  if (peerName) return peerName;
  if (row.peerId != null) return `用户 #${row.peerId}`;
  const matched = /^c_(\d+)_(\d+)$/.exec(row.cid);
  if (matched == null) return row.cid;
  const left = Number(matched[1]);
  const right = Number(matched[2]);
  return `用户 #${left === myId ? right : left}`;
}

function currentDateLabel(): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

export function ConversationsScreen({ navigation }: Props) {
  const myId = useAppStore(state => state.myId);
  const displayName = useAppStore(state => state.displayName);
  const connState = useAppStore(state => state.connState);
  const [items, setItems] = useState<ConversationRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const { theme } = useAppTheme();

  const reload = useCallback(async () => {
    const rows = await sdk.sync.getConversations();
    if (mountedRef.current) setItems(rows);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await sdk.sync.syncAll();
    } catch (cause) {
      if (mountedRef.current)
        setError(cause instanceof Error ? cause.message : '同步失败');
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
        await reload();
      }
    }
  }, [reload]);

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    const offConversation = sdk.chat.on('conversation', () => void reload());
    const offSync = sdk.chat.on('syncState', state => {
      if (!mountedRef.current) return;
      setRefreshing(state.running);
      setError(state.error);
      if (!state.running) void reload();
    });
    return () => {
      mountedRef.current = false;
      offConversation();
      offSync();
    };
  }, [reload]);

  const statusColor =
    connState === 'connected'
      ? theme.colors.success
      : connState === 'closed'
      ? theme.colors.danger
      : theme.colors.warning;
  const statusLabel =
    connState === 'connected'
      ? '在线'
      : connState === 'closed'
      ? '离线'
      : '连接中';

  return (
    <RootScreenBackground>
      <View style={styles.header}>
        <View style={styles.accountLine}>
          <View style={styles.account}>
            <View style={styles.avatarWrap}>
              <InitialAvatar name={displayName} userId={myId} size={44} />
              <PresenceDot
                color={statusColor}
                size={11}
                style={styles.statusDot}
              />
            </View>
            <View style={styles.accountCopy}>
              <Text
                style={[styles.accountName, { color: theme.colors.text }]}
                numberOfLines={1}
              >
                {displayName || `用户 #${myId ?? ''}`}
              </Text>
              <Text style={[styles.accountStatus, { color: statusColor }]}>
                {statusLabel}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <IconButton
              name="person-add-outline"
              accessibilityLabel="发起单聊"
              backgroundColor={theme.colors.primarySoft}
              color={theme.colors.primary}
              onPress={() => navigation.navigate('ContactsTab')}
            />
            <IconButton
              name="people-outline"
              accessibilityLabel="创建群聊"
              backgroundColor={theme.colors.primarySoft}
              color={theme.colors.primary}
              onPress={() => navigation.navigate('CreateGroup')}
            />
          </View>
        </View>
        <Text style={[styles.date, { color: theme.colors.textMuted }]}>
          {currentDateLabel()}
        </Text>
        <Text style={[styles.title, { color: theme.colors.text }]}>聊天</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
          保持专注，也保持连接
        </Text>
        <View
          style={[
            styles.search,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <Ionicons
            name="search-outline"
            size={18}
            color={theme.colors.textMuted}
          />
          <Text style={[styles.searchText, { color: theme.colors.textMuted }]}>
            搜索会话、消息与联系人
          </Text>
        </View>
      </View>

      {error ? (
        <View style={styles.notice}>
          <StatusNotice
            message={`同步失败：${error}（本地消息仍可查看）`}
            tone="error"
          />
        </View>
      ) : null}

      <FlatList
        style={[
          styles.listSurface,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}
        contentContainerStyle={
          items.length === 0 ? styles.emptyList : styles.list
        }
        data={items}
        keyExtractor={item => item.cid}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View
              style={[
                styles.emptyIcon,
                { backgroundColor: theme.colors.primarySoft },
              ]}
            >
              <Ionicons
                name="chatbubbles-outline"
                size={31}
                color={theme.colors.primary}
              />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
              {refreshing ? '正在同步会话' : '还没有消息'}
            </Text>
            <Text
              style={[
                styles.emptyDescription,
                { color: theme.colors.textSecondary },
              ]}
            >
              {refreshing
                ? '请稍候，正在获取最新内容…'
                : '前往通讯录找到同事，或创建一个群聊'}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const title = titleOf(item, myId);
          return (
            <ConversationRowView
              row={item}
              title={title}
              formattedTime={formatConversationTime(item.lastMsgTs)}
              entranceIndex={index}
              onPress={() =>
                navigation.navigate('Chat', {
                  cid: item.cid,
                  title,
                  conversationType: item.type,
                  groupId: item.groupId ?? undefined,
                  syncOnOpen: true,
                })
              }
            />
          );
        }}
      />
    </RootScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingBottom: 0,
  },
  accountLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  account: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarWrap: { position: 'relative' },
  statusDot: {
    position: 'absolute',
    right: -2,
    bottom: 0,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 14, fontWeight: '800' },
  accountStatus: { marginTop: 2, fontSize: 10, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: SPACING.xs },
  date: { marginTop: SPACING.lg, fontSize: TYPE.caption, fontWeight: '600' },
  title: {
    marginTop: 2,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  subtitle: { marginTop: 2, fontSize: TYPE.caption },
  search: {
    height: 44,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  searchText: { fontSize: 13 },
  notice: { marginHorizontal: SPACING.md, marginTop: SPACING.sm },
  listSurface: {
    flex: 1,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  list: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.md },
  emptyList: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.md,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 56,
  },
  emptyIcon: {
    width: 66,
    height: 66,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    marginTop: SPACING.md,
    fontSize: TYPE.subtitle,
    fontWeight: '800',
  },
  emptyDescription: {
    marginTop: SPACING.xs,
    fontSize: TYPE.body,
    lineHeight: 22,
    textAlign: 'center',
  },
});
