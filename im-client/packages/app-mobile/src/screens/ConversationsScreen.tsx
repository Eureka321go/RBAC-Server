import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ConversationRow } from '@im/sdk-core';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { GroupAvatar, InitialAvatar } from '../components/Avatar';
import { IconButton } from '../components/IconButton';
import { StatusNotice } from '../components/StatusNotice';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Conversations'>;

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

function timeOf(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function ConversationsScreen({ navigation }: Props) {
  const myId = useAppStore((state) => state.myId);
  const displayName = useAppStore((state) => state.displayName);
  const connState = useAppStore((state) => state.connState);
  const logout = useAppStore((state) => state.logout);
  const [items, setItems] = useState<ConversationRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

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
      if (mountedRef.current) {
        setError(cause instanceof Error ? cause.message : '同步失败');
      }
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
    const offSync = sdk.chat.on('syncState', (state) => {
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

  const connectionMeta = connState === 'connected'
    ? { color: COLORS.success, label: '在线' }
    : connState === 'closed'
      ? { color: COLORS.danger, label: '离线' }
      : { color: COLORS.warning, label: '连接中' };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerTopLine}>
          <View style={styles.profile}>
            <View
              accessible
              accessibilityLabel={`连接状态：${connectionMeta.label}`}
              style={styles.avatarWrap}
            >
              <InitialAvatar name={displayName} userId={myId} size={46} />
              <View style={[styles.connectionDot, { backgroundColor: connectionMeta.color }]} />
            </View>
            <View style={styles.profileText}>
              <Text style={styles.accountLabel}>当前账号</Text>
              <Text style={styles.displayName} numberOfLines={1}>
                {displayName || `用户 #${myId ?? ''}`}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <IconButton
              name="person-add-outline"
              accessibilityLabel="发起单聊"
              backgroundColor={COLORS.primarySoft}
              color={COLORS.primary}
              size={21}
              style={styles.actionButton}
              onPress={() => navigation.navigate('Contacts')}
            />
            <IconButton
              name="people-outline"
              accessibilityLabel="创建群聊"
              backgroundColor={COLORS.primarySoft}
              color={COLORS.primary}
              size={21}
              style={styles.actionButton}
              onPress={() => navigation.navigate('CreateGroup')}
            />
            <IconButton
              name="log-out-outline"
              accessibilityLabel="退出登录"
              backgroundColor={COLORS.dangerSoft}
              color={COLORS.danger}
              size={21}
              style={styles.actionButton}
              onPress={() => void logout()}
            />
          </View>
        </View>
        <Text style={styles.pageTitle}>消息</Text>
        <Text style={styles.pageSubtitle}>
          {items.length > 0 ? `${items.length} 个会话` : '与同事保持联系'}
        </Text>
      </View>
      {error ? (
        <View style={styles.notice}>
          <StatusNotice message={`同步失败：${error}（本地消息仍可查看）`} tone="error" />
        </View>
      ) : null}
      <FlatList
        style={styles.listSurface}
        contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
        data={items}
        keyExtractor={(item) => item.cid}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="chatbubbles-outline" size={30} color={COLORS.primary} />
            </View>
            <Text style={styles.emptyTitle}>{refreshing ? '正在同步会话' : '还没有消息'}</Text>
            <Text style={styles.emptyDescription}>
              {refreshing ? '请稍候，正在获取最新内容…' : '点击右上角按钮发起单聊或创建群聊'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const title = titleOf(item, myId);
          const time = timeOf(item.updatedAt);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}，${item.muted ? '已开启消息免打扰，' : ''}${item.lastMsgPreview || '暂无消息'}`}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => navigation.navigate('Chat', {
                cid: item.cid,
                title,
                conversationType: item.type,
                groupId: item.groupId ?? undefined,
                syncOnOpen: true,
              })}
            >
              {item.type === 'GROUP' ? (
                <GroupAvatar size={48} />
              ) : (
                <InitialAvatar name={title} userId={item.peerId} size={48} />
              )}
              <View style={styles.content}>
                <View style={styles.titleLine}>
                  <Text style={styles.title} numberOfLines={1}>{title}</Text>
                  {item.muted ? (
                    <Ionicons
                      accessibilityLabel="已开启消息免打扰"
                      name="volume-mute-outline"
                      size={16}
                      color={COLORS.textMuted}
                    />
                  ) : null}
                  {time ? <Text style={styles.time}>{time}</Text> : null}
                </View>
                <View style={styles.previewLine}>
                  {item.hasMention ? <Text style={styles.mention}>[有人@我]</Text> : null}
                  <Text style={styles.preview} numberOfLines={1}>
                    {item.lastMsgPreview || '暂无消息'}
                  </Text>
                </View>
              </View>
              {item.unreadCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {item.unreadCount > 99 ? '99+' : item.unreadCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.page },
  header: {
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: RADIUS.lg,
    borderBottomRightRadius: RADIUS.lg,
  },
  headerTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profile: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarWrap: { position: 'relative' },
  connectionDot: {
    position: 'absolute',
    right: -1,
    bottom: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  profileText: { flex: 1, minWidth: 0 },
  accountLabel: { color: COLORS.textMuted, fontSize: TYPE.caption, marginBottom: 2 },
  displayName: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '700' },
  actions: { marginLeft: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionButton: { width: 44, height: 44 },
  pageTitle: {
    marginTop: SPACING.lg,
    color: COLORS.text,
    fontSize: TYPE.hero,
    lineHeight: 34,
    fontWeight: '800',
  },
  pageSubtitle: { marginTop: 2, color: COLORS.textSecondary, fontSize: TYPE.caption },
  notice: { marginHorizontal: SPACING.md, marginTop: SPACING.sm },
  listSurface: {
    margin: SPACING.md,
    marginBottom: 0,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  list: { paddingHorizontal: SPACING.md },
  emptyList: { flexGrow: 1, paddingHorizontal: SPACING.xl },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  emptyTitle: { marginTop: SPACING.md, color: COLORS.text, fontSize: TYPE.subtitle, fontWeight: '700' },
  emptyDescription: {
    marginTop: SPACING.xs,
    color: COLORS.textSecondary,
    fontSize: TYPE.body,
    lineHeight: 22,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 80,
    paddingHorizontal: 0,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  rowPressed: { backgroundColor: COLORS.surfaceMuted },
  content: { flex: 1, minWidth: 0, gap: 6 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', color: COLORS.text },
  time: { color: COLORS.textMuted, fontSize: TYPE.caption },
  previewLine: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  mention: { flexShrink: 0, marginRight: 4, color: COLORS.danger, fontSize: TYPE.caption, fontWeight: '600' },
  preview: { flex: 1, minWidth: 0, color: COLORS.textSecondary, fontSize: 14 },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: COLORS.white, fontSize: TYPE.caption, fontWeight: '700' },
});
