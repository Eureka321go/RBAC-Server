import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ConversationRow } from '@im/sdk-core';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { GroupAvatar, InitialAvatar } from '../components/Avatar';
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

export function ConversationsScreen({ navigation }: Props) {
  const myId = useAppStore((state) => state.myId);
  const displayName = useAppStore((state) => state.displayName);
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

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.profile}>
          <InitialAvatar name={displayName} userId={myId} size={44} />
          <View style={styles.profileText}>
            <Text style={styles.displayName} numberOfLines={1}>
              {displayName || `用户 #${myId ?? ''}`}
            </Text>
            <Text style={styles.sectionName}>消息</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.newButton, pressed && styles.buttonPressed]}
            onPress={() => navigation.navigate('Contacts')}
          >
            <Text style={styles.newButtonText}>单聊</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.newButton, pressed && styles.buttonPressed]}
            onPress={() => navigation.navigate('CreateGroup')}
          >
            <Text style={styles.newButtonText}>群聊</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.logoutButton, pressed && styles.buttonPressed]}
            onPress={() => void logout()}
          >
            <Text style={styles.logoutText}>登出</Text>
          </Pressable>
        </View>
      </View>
      {error ? (
        <Text style={styles.error}>同步失败：{error}（本地消息仍可查看）</Text>
      ) : null}
      <FlatList
        contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
        data={items}
        keyExtractor={(item) => item.cid}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {refreshing ? '正在同步会话…' : '暂无会话，点击“新建会话”开始聊天'}
          </Text>
        }
        renderItem={({ item }) => {
          const title = titleOf(item, myId);
          return (
            <Pressable
              style={styles.row}
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
                  <Text style={styles.title}>{title}</Text>
                  {item.hasMention ? <Text style={styles.mention}>有人@我</Text> : null}
                </View>
                <Text style={styles.preview} numberOfLines={1}>
                  {item.lastMsgPreview || '暂无消息'}
                </Text>
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
  wrap: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  profile: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileText: { flex: 1, minWidth: 0 },
  displayName: { color: '#0f172a', fontSize: 17, fontWeight: '700' },
  sectionName: { color: '#64748b', fontSize: 12, marginTop: 2 },
  actions: { marginLeft: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  newButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
  },
  newButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  logoutButton: {
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  logoutText: { color: '#475569', fontSize: 14, fontWeight: '600' },
  buttonPressed: { opacity: 0.72 },
  error: {
    marginHorizontal: 16,
    marginTop: 10,
    color: '#b91c1c',
    backgroundColor: '#fee2e2',
    padding: 8,
    borderRadius: 6,
  },
  list: { paddingHorizontal: 16 },
  emptyList: { flexGrow: 1, paddingHorizontal: 16 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 80 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 76,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  content: { flex: 1, gap: 6 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '600', color: '#111827' },
  mention: { color: '#b45309', fontSize: 12 },
  preview: { color: '#6b7280', fontSize: 14 },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
