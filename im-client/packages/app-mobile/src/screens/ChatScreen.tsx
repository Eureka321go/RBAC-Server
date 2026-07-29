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
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

function textOf(m: ChatMessage): string {
  const t = m.body?.text;
  return typeof t === 'string' ? t : '';
}

export function ChatScreen({ route, navigation }: Props) {
  const { cid, title, syncOnOpen = true } = route.params;
  const myId = useAppStore((s) => s.myId);
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [peerReadSeq, setPeerReadSeq] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [banner, setBanner] = useState<string | null>(null);

  // 组件是否仍处于挂载状态；卸载后用它守卫所有异步回调里的 setState，避免对已卸载组件调用。
  const mountedRef = useRef(true);
  // 页面实例复用到另一个 cid 时，旧会话尚未结束的异步读取不得污染新会话。
  const activeCidRef = useRef(cid);
  activeCidRef.current = cid;
  // 横幅自动消失的定时器；每次新错误到来时需要清掉旧的，重新计时 3 秒。
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = useCallback((message: string) => {
    if (!mountedRef.current) return;
    setBanner(message);
    if (bannerTimerRef.current != null) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => {
      bannerTimerRef.current = null;
      if (mountedRef.current) setBanner(null);
    }, 3000);
  }, []);

  const reload = useCallback(async () => {
    const [list, readState] = await Promise.all([
      sdk.chat.getChatMessages(cid),
      sdk.chat.getReadState(cid),
    ]);
    if (!mountedRef.current || activeCidRef.current !== cid) return;
    setItems(list);
    setPeerReadSeq((current) => {
      if (readState.peerReadSeq == null) return current;
      return Math.max(current ?? 0, readState.peerReadSeq);
    });
    const maxSeq = list.reduce(
      (max, item) => (item.seq == null ? max : Math.max(max, item.seq)),
      0,
    );
    if (maxSeq > 0) {
      try {
        await sdk.chat.markRead(cid, maxSeq);
      } catch (cause) {
        if (activeCidRef.current === cid) {
          showBanner(`已读上报失败：${cause instanceof Error ? cause.message : 'unknown'}`);
        }
      }
    }
  }, [cid, showBanner]);

  const safeReload = useCallback(() => {
    void reload().catch((cause) => {
      if (mountedRef.current && activeCidRef.current === cid) {
        showBanner(`刷新失败：${cause instanceof Error ? cause.message : 'unknown'}`);
      }
    });
  }, [cid, reload, showBanner]);

  useEffect(() => {
    mountedRef.current = true;
    setItems([]);
    setPeerReadSeq(null);
    setBanner(null);
    if (syncOnOpen) {
      void sdk.sync.syncConversation(cid).then(safeReload).catch((cause) => {
        if (!mountedRef.current || activeCidRef.current !== cid) return;
        showBanner(`同步失败：${cause instanceof Error ? cause.message : 'unknown'}`);
        safeReload();
      });
    } else {
      safeReload();
    }
    const offMsg = sdk.chat.on('message', (p) => {
      if (p.cid === cid) safeReload();
    });
    const offRead = sdk.chat.on('readReceipt', (p) => {
      if (p.cid !== cid || !mountedRef.current || activeCidRef.current !== cid) return;
      setPeerReadSeq((current) => Math.max(current ?? 0, p.readSeq));
    });
    const offConnection = sdk.connection.on('state', (state) => {
      if (state === 'connected' && mountedRef.current) safeReload();
    });
    const offErr = sdk.chat.on('sendError', (p) => {
      if (p.cid !== cid) return;
      showBanner(`发送失败：${p.reason}`);
    });
    return () => {
      mountedRef.current = false;
      if (bannerTimerRef.current != null) {
        clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
      offMsg();
      offRead();
      offConnection();
      offErr();
    };
  }, [cid, safeReload, showBanner, syncOnOpen]);

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
      <CompactScreenHeader title={title} onBack={() => navigation.goBack()} />
      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => (m.seq != null ? `s:${m.seq}` : `c:${m.clientMsgId}`)}
        renderItem={({ item }) => {
          const mine = item.seq == null || item.senderId === myId;
          return (
            <View style={[styles.rowWrap, mine ? styles.rowMine : styles.rowPeer]}>
              <View style={styles.messageContent}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
                  <Text style={mine ? styles.textMine : styles.textPeer}>{textOf(item)}</Text>
                </View>
                {mine && item.seq != null ? (
                  <Text style={styles.deliveryStatus}>
                    {peerReadSeq != null && item.seq <= peerReadSeq ? '已读' : '已发送'}
                  </Text>
                ) : null}
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
  messageContent: { maxWidth: '75%' },
  bubble: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: '#2563eb' },
  bubblePeer: { backgroundColor: '#e5e7eb' },
  textMine: { color: '#fff', fontSize: 15 },
  textPeer: { color: '#111827', fontSize: 15 },
  deliveryStatus: { alignSelf: 'flex-end', color: '#94a3b8', fontSize: 11, marginTop: 2 },
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
