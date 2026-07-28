import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Button, FlatList, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ConversationRow } from '@im/sdk-core';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Conversations'>;

function titleOf(row: ConversationRow, myId: number | null): string {
  if (row.type === 'GROUP') return `群聊 #${row.groupId ?? row.cid.slice(2)}`;
  const matched = /^c_(\d+)_(\d+)$/.exec(row.cid);
  if (matched == null) return row.cid;
  const left = Number(matched[1]);
  const right = Number(matched[2]);
  return `用户 #${left === myId ? right : left}`;
}

export function ConversationsScreen({ navigation }: Props) {
  const myId = useAppStore((state) => state.myId);
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
      <View style={styles.actions}>
        <Button title="新建会话" onPress={() => navigation.navigate('Contacts')} />
        <Button title="登出" onPress={() => void logout()} />
      </View>
      {error ? <Text style={styles.error}>同步失败：{error}（本地消息仍可查看）</Text> : null}
      <FlatList
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
              onPress={() => navigation.navigate('Chat', { cid: item.cid, title, syncOnOpen: true })}
            >
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
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  error: { color: '#b91c1c', backgroundColor: '#fee2e2', padding: 8, borderRadius: 6 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 80 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
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
