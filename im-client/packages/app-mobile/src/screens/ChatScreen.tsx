import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatMessage } from '@im/sdk-core';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

function textOf(m: ChatMessage): string {
  const t = m.body?.text;
  return typeof t === 'string' ? t : '';
}

export function ChatScreen({ route }: Props) {
  const { cid } = route.params;
  const myId = useAppStore((s) => s.myId);
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [banner, setBanner] = useState<string | null>(null);

  // 组件是否仍处于挂载状态；卸载后用它守卫所有异步回调里的 setState，避免对已卸载组件调用。
  const mountedRef = useRef(true);
  // 横幅自动消失的定时器；每次新错误到来时需要清掉旧的，重新计时 3 秒。
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const list = await sdk.chat.getChatMessages(cid);
    if (!mountedRef.current) return;
    setItems(list);
  }, [cid]);

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    const offMsg = sdk.chat.on('message', (p) => {
      if (p.cid === cid) void reload();
    });
    const offErr = sdk.chat.on('sendError', (p) => {
      if (p.cid !== cid) return;
      setBanner(`发送失败：${p.reason}`);
      if (bannerTimerRef.current != null) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => {
        bannerTimerRef.current = null;
        if (mountedRef.current) setBanner(null);
      }, 3000);
    });
    return () => {
      mountedRef.current = false;
      if (bannerTimerRef.current != null) {
        clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
      offMsg();
      offErr();
    };
  }, [cid, reload]);

  // inverted 列表要倒序数据：最新的在数组头部。
  const data = useMemo(() => [...items].reverse(), [items]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text === '') return;
    setDraft('');
    await sdk.chat.sendText(cid, text);
  }, [cid, draft]);

  return (
    <View style={styles.wrap}>
      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => (m.seq != null ? `s:${m.seq}` : `c:${m.clientMsgId}`)}
        renderItem={({ item }) => {
          const mine = item.seq == null || item.senderId === myId;
          return (
            <View style={[styles.rowWrap, mine ? styles.rowMine : styles.rowPeer]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
                <Text style={mine ? styles.textMine : styles.textPeer}>{textOf(item)}</Text>
              </View>
              {item.status === 'sending' || item.status === 'acked' ? (
                <ActivityIndicator size="small" />
              ) : null}
              {item.status === 'failed' && item.clientMsgId ? (
                <Pressable onPress={() => sdk.chat.resend(item.clientMsgId!)}>
                  <Text style={styles.retry}>!</Text>
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="说点什么"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void send()}
        />
        <Button title="发送" onPress={() => void send()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  banner: { backgroundColor: '#fee2e2', color: '#b91c1c', padding: 8, textAlign: 'center' },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 4 },
  rowMine: { justifyContent: 'flex-end' },
  rowPeer: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '75%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: '#2563eb' },
  bubblePeer: { backgroundColor: '#e5e7eb' },
  textMine: { color: '#fff', fontSize: 15 },
  textPeer: { color: '#111827', fontSize: 15 },
  retry: { color: '#dc2626', fontSize: 18, fontWeight: '700', paddingHorizontal: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  input: { flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10 },
});
