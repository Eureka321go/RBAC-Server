import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { ChatMessage } from '@im/sdk-core';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import type { RootStackParamList } from '../navigation/types';
import { formatGroupSystemMessage } from '../group/systemMessage';
import { buildContactDirectory } from '../contact/directory';
import { InitialAvatar } from '../components/Avatar';
import { IconButton } from '../components/IconButton';
import { StatusNotice } from '../components/StatusNotice';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

function textOf(m: ChatMessage): string {
  const t = m.body?.text;
  return typeof t === 'string' ? t : '';
}

export function ChatScreen({ route, navigation }: Props) {
  const {
    cid,
    title,
    conversationType,
    groupId,
    syncOnOpen = true,
  } = route.params;
  const myId = useAppStore((s) => s.myId);
  const myDisplayName = useAppStore((s) => s.displayName);
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [displayTitle, setDisplayTitle] = useState(title);
  const [namesById, setNamesById] = useState<ReadonlyMap<number, string>>(
    () => new Map(),
  );
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

  useFocusEffect(useCallback(() => {
    if (conversationType !== 'GROUP' || groupId == null) {
      setDisplayTitle(title);
      setNamesById(new Map());
      return;
    }
    let active = true;
    void Promise.all([
      sdk.groups.getGroup(groupId).catch(() => null),
      sdk.groups.getMembers(groupId).catch(() => []),
      sdk.contacts.getDirectory().catch(() => null),
    ]).then(([group, members, directory]) => {
      if (!active) return;
      setDisplayTitle(group?.name ?? title);
      const names = directory == null
        ? new Map<number, string>()
        : new Map(buildContactDirectory(directory).namesById);
      members.forEach((member) => {
        const name = member.displayName?.trim();
        if (name) names.set(member.userId, name);
      });
      setNamesById(names);
    });
    return () => {
      active = false;
    };
  }, [conversationType, groupId, title]));

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
      <CompactScreenHeader
        title={displayTitle}
        onBack={() => navigation.goBack()}
        rightIcon={conversationType === 'GROUP' && groupId != null ? 'settings-outline' : undefined}
        rightAccessibilityLabel="群资料"
        onRightPress={conversationType === 'GROUP' && groupId != null
          ? () => navigation.navigate('GroupDetails', { cid, groupId, title: displayTitle })
          : undefined}
      />
      {banner ? <View style={styles.banner}><StatusNotice message={banner} tone="error" /></View> : null}
      <FlatList
        inverted
        contentContainerStyle={styles.messageList}
        data={data}
        keyExtractor={(m) => (m.seq != null ? `s:${m.seq}` : `c:${m.clientMsgId}`)}
        renderItem={({ item }) => {
          if (item.type === 'SYSTEM') {
            return (
              <View style={styles.systemRow}>
                <Text style={styles.systemText}>
                  {formatGroupSystemMessage(item, namesById)}
                </Text>
              </View>
            );
          }
          const mine = item.seq == null || item.senderId === myId;
          const senderId = mine ? myId : item.senderId;
          const senderName = mine
            ? myDisplayName?.trim() || (myId == null ? '我' : `用户 #${myId}`)
            : conversationType === 'GROUP'
              ? (item.senderId == null
                ? '未知用户'
                : namesById.get(item.senderId)?.trim() || `用户 #${item.senderId}`)
              : displayTitle;
          const showSenderName = conversationType === 'GROUP' && !mine;
          return (
            <View style={[
              styles.rowWrap,
              mine ? styles.rowMine : styles.rowPeer,
              showSenderName && styles.rowWithSenderName,
            ]}>
              {!mine ? (
                <InitialAvatar name={senderName} userId={senderId} size={36} />
              ) : null}
              <View style={styles.messageContent}>
                {showSenderName ? (
                  <Text style={styles.senderName} numberOfLines={1}>{senderName}</Text>
                ) : null}
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
                  <Text style={mine ? styles.textMine : styles.textPeer}>{textOf(item)}</Text>
                </View>
                {conversationType === 'SINGLE' && mine && item.seq != null ? (
                  <Text style={styles.deliveryStatus}>
                    {peerReadSeq != null && item.seq <= peerReadSeq ? '已读' : '已发送'}
                  </Text>
                ) : null}
              </View>
              {item.status === 'sending' || item.status === 'acked' ? (
                <ActivityIndicator size="small" />
              ) : null}
              {item.status === 'failed' && item.clientMsgId ? (
                <IconButton
                  name="alert-circle"
                  accessibilityLabel="重新发送"
                  color={COLORS.danger}
                  onPress={() => sdk.chat.resend(item.clientMsgId!)}
                />
              ) : null}
              {mine ? (
                <InitialAvatar name={senderName} userId={senderId} size={36} />
              ) : null}
            </View>
          );
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.composerSafeArea}>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="说点什么"
            placeholderTextColor={COLORS.textMuted}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void send()}
          />
          <IconButton
            name="send"
            accessibilityLabel="发送"
            disabled={draft.trim() === ''}
            color={COLORS.white}
            backgroundColor={draft.trim() === '' ? COLORS.textMuted : COLORS.primary}
            onPress={() => void send()}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.page },
  banner: { paddingHorizontal: SPACING.md, paddingTop: SPACING.xs },
  messageList: { paddingVertical: SPACING.xs },
  rowWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  rowMine: { justifyContent: 'flex-end' },
  rowPeer: { justifyContent: 'flex-start' },
  rowWithSenderName: { paddingTop: 24 },
  messageContent: { maxWidth: '70%' },
  senderName: {
    position: 'absolute',
    top: -20,
    left: 4,
    right: 0,
    color: COLORS.textSecondary,
    fontSize: TYPE.caption,
    lineHeight: 17,
  },
  bubble: { borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  bubbleMine: { backgroundColor: COLORS.primary },
  bubblePeer: { backgroundColor: COLORS.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  textMine: { color: COLORS.white, fontSize: TYPE.body, lineHeight: 21 },
  textPeer: { color: COLORS.text, fontSize: TYPE.body, lineHeight: 21 },
  deliveryStatus: { alignSelf: 'flex-end', color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  systemRow: { alignItems: 'center', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xs },
  systemText: {
    color: COLORS.textSecondary,
    backgroundColor: '#E9EEF5',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
    fontSize: TYPE.caption,
    textAlign: 'center',
  },
  composerSafeArea: { backgroundColor: COLORS.surface },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 108,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
    color: COLORS.text,
    fontSize: TYPE.body,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
});
