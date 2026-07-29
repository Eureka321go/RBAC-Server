import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { ChatMessage, GroupMember, GroupRole } from '@im/sdk-core';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import type { RootStackParamList } from '../navigation/types';
import { formatGroupSystemMessage } from '../group/systemMessage';
import { buildContactDirectory } from '../contact/directory';
import { InitialAvatar } from '../components/Avatar';
import { IconButton } from '../components/IconButton';
import { MessageActionSheet } from '../components/MessageActionSheet';
import {
  MentionPickerSheet,
  type MentionPickerSelection,
} from '../components/MentionPickerSheet';
import { MentionText } from '../components/MentionText';
import { StatusNotice } from '../components/StatusNotice';
import {
  applyMentionTextChange,
  findInsertedMentionTrigger,
  insertMentionSelection,
  toSendTextOptions,
  type MentionDraftState,
  type MentionTrigger,
} from '../mention/mentionDraft';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const RECALL_WINDOW_MS = 120_000;

function targetSeqOf(message: ChatMessage): number | null {
  const value = message.body?.targetSeq;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function canRecallMessage(
  message: ChatMessage,
  myId: number | null,
  conversationType: 'SINGLE' | 'GROUP',
  myGroupRole: GroupRole | null,
  now = Date.now(),
): boolean {
  if (myId == null || message.seq == null || message.status !== 'sent') return false;
  if (message.recalled || message.type === 'SYSTEM' || message.type === 'RECALL') return false;
  if (!Number.isFinite(message.ts) || message.ts <= 0) return false;
  const timestamp = message.ts < 10_000_000_000 ? message.ts * 1000 : message.ts;
  if (now - timestamp > RECALL_WINDOW_MS) return false;
  if (message.senderId === myId) return true;
  return conversationType === 'GROUP'
    && (myGroupRole === 'OWNER' || myGroupRole === 'ADMIN');
}

function recallErrorText(reason?: string): string {
  switch (reason) {
    case 'RECALL_WINDOW_EXPIRED': return '消息已超过可撤回时间';
    case 'RECALL_NO_PERMISSION': return '你没有权限撤回这条消息';
    case 'RECALL_TARGET_NOT_FOUND': return '消息不存在或已被处理';
    case 'NOT_RECALLABLE': return '这条消息不能撤回';
    case 'NOT_MEMBER': return '你已不在当前会话中';
    case 'OFFLINE': return '当前离线，连接恢复后重试';
    case 'RECALL_PENDING': return '正在撤回上一条消息，请稍候';
    default: return '撤回失败，请稍后重试';
  }
}

function sendErrorText(reason: string): string {
  switch (reason) {
    case 'MENTION_NOT_MEMBER': return '提及的成员已不在群聊中';
    case 'MENTION_ALL_FORBIDDEN': return '只有群主或管理员可以@所有人';
    default: return `发送失败：${reason}`;
  }
}

function emptyMentionDraft(): MentionDraftState {
  return { text: '', ranges: [] };
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
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersLoadFailed, setMembersLoadFailed] = useState(false);
  const [myGroupRole, setMyGroupRole] = useState<GroupRole | null>(null);
  const [peerReadSeq, setPeerReadSeq] = useState<number | null>(null);
  const [draft, setDraft] = useState<MentionDraftState>(emptyMentionDraft);
  const [draftSelection, setDraftSelection] = useState({ start: 0, end: 0 });
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [mentionPickerVisible, setMentionPickerVisible] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const [recallingSeq, setRecallingSeq] = useState<number | null>(null);

  // 组件是否仍处于挂载状态；卸载后用它守卫所有异步回调里的 setState，避免对已卸载组件调用。
  const mountedRef = useRef(true);
  // 页面实例复用到另一个 cid 时，旧会话尚未结束的异步读取不得污染新会话。
  const activeCidRef = useRef(cid);
  activeCidRef.current = cid;
  // 横幅自动消失的定时器；每次新错误到来时需要清掉旧的，重新计时 3 秒。
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

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
      setGroupMembers([]);
      setMembersLoading(false);
      setMembersLoadFailed(false);
      setMyGroupRole(null);
      return;
    }
    setGroupMembers([]);
    setMembersLoading(true);
    setMembersLoadFailed(false);
    setMyGroupRole(null);
    let active = true;
    void Promise.all([
      sdk.groups.getGroup(groupId).catch(() => null),
      sdk.groups.getMembers(groupId)
        .then((members) => ({ members, failed: false }))
        .catch(() => ({ members: [] as GroupMember[], failed: true })),
      sdk.contacts.getDirectory().catch(() => null),
    ]).then(([group, memberResult, directory]) => {
      if (!active) return;
      const { members } = memberResult;
      setDisplayTitle(group?.name ?? title);
      setGroupMembers(members);
      setMembersLoading(false);
      setMembersLoadFailed(memberResult.failed);
      setMyGroupRole(
        group?.myRole
          ?? members.find((member) => member.userId === myId)?.role
          ?? null,
      );
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
  }, [conversationType, groupId, myId, title]));

  useEffect(() => {
    mountedRef.current = true;
    setItems([]);
    setPeerReadSeq(null);
    setBanner(null);
    setSelectedMessage(null);
    setRecallingSeq(null);
    setDraft(emptyMentionDraft());
    setDraftSelection({ start: 0, end: 0 });
    setMentionTrigger(null);
    setMentionPickerVisible(false);
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
      showBanner(sendErrorText(p.reason));
    });
    const offRecall = sdk.chat.on('recallResult', (result) => {
      if (result.cid !== cid || !mountedRef.current || activeCidRef.current !== cid) return;
      setRecallingSeq(null);
      if (result.status === 'succeeded') {
        safeReload();
        return;
      }
      if (result.status === 'failed') {
        showBanner(recallErrorText(result.reason));
        return;
      }
      void sdk.sync.syncConversation(cid)
        .then(() => {
          if (!mountedRef.current || activeCidRef.current !== cid) return;
          safeReload();
          showBanner('撤回结果确认超时，已刷新会话');
        })
        .catch((cause) => {
          if (!mountedRef.current || activeCidRef.current !== cid) return;
          showBanner(`撤回结果确认超时，刷新失败：${cause instanceof Error ? cause.message : 'unknown'}`);
        });
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
      offRecall();
    };
  }, [cid, safeReload, showBanner, syncOnOpen]);

  // inverted 列表要倒序数据：最新的在数组头部。
  const { data, recallOperators } = useMemo(() => {
    const operators = new Map<number, number | null>();
    const visible = items.filter((item) => {
      if (item.type !== 'RECALL') return true;
      const targetSeq = targetSeqOf(item);
      if (targetSeq != null) operators.set(targetSeq, item.senderId);
      return false;
    });
    return { data: visible.reverse(), recallOperators: operators };
  }, [items]);

  const send = useCallback(async () => {
    const { text } = draft;
    if (text.trim() === '') return;
    const options = toSendTextOptions(draft);
    setDraft(emptyMentionDraft());
    setDraftSelection({ start: 0, end: 0 });
    setMentionTrigger(null);
    setMentionPickerVisible(false);
    await sdk.chat.sendText(cid, text, options);
  }, [cid, draft]);

  const excludedMentionUserIds = useMemo(
    () => new Set(toSendTextOptions(draft).mentions ?? []),
    [draft],
  );

  const changeDraftText = useCallback((nextText: string) => {
    const trigger = findInsertedMentionTrigger(draft.text, nextText);
    setDraft(applyMentionTextChange(draft, nextText));
    if (conversationType !== 'GROUP' || trigger == null) return;
    if (membersLoading) {
      showBanner('群成员正在加载，请稍后重试');
      return;
    }
    if (membersLoadFailed) {
      showBanner('群成员加载失败，请稍后重试');
      return;
    }
    setMentionTrigger(trigger);
    setMentionPickerVisible(true);
  }, [conversationType, draft, membersLoadFailed, membersLoading, showBanner]);

  const closeMentionPicker = useCallback(() => {
    setMentionPickerVisible(false);
    setMentionTrigger(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const confirmMentionSelection = useCallback((selection: MentionPickerSelection) => {
    if (mentionTrigger == null) {
      closeMentionPicker();
      return;
    }
    const mentionSelection = selection.kind === 'all'
      ? 'all' as const
      : selection.members.map((member) => ({
          userId: member.userId,
          displayName: member.displayName?.trim() || `用户 #${member.userId}`,
        }));
    const result = insertMentionSelection(draft, mentionTrigger, mentionSelection);
    setDraft(result.state);
    setDraftSelection({ start: result.cursor, end: result.cursor });
    setMentionPickerVisible(false);
    setMentionTrigger(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [closeMentionPicker, draft, mentionTrigger]);

  const recallSelected = useCallback(async () => {
    const message = selectedMessage;
    if (message?.seq == null) return;
    if (!canRecallMessage(message, myId, conversationType, myGroupRole)) {
      setSelectedMessage(null);
      showBanner('这条消息当前不能撤回');
      return;
    }
    const targetSeq = message.seq;
    setSelectedMessage(null);
    setRecallingSeq(targetSeq);
    try {
      await sdk.chat.recall(cid, targetSeq);
    } catch (cause) {
      setRecallingSeq(null);
      showBanner(recallErrorText(cause instanceof Error ? cause.message : undefined));
    }
  }, [cid, conversationType, myGroupRole, myId, selectedMessage, showBanner]);

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
          if (item.recalled) {
            const operatorId = item.seq == null ? null : recallOperators.get(item.seq);
            let label = '消息已撤回';
            if (operatorId === myId) {
              label = '你撤回了一条消息';
            } else if (operatorId != null) {
              const operatorName = conversationType === 'GROUP'
                ? namesById.get(operatorId)?.trim() || `用户 #${operatorId}`
                : displayTitle;
              label = `${operatorName}撤回了一条消息`;
            }
            return (
              <View style={styles.recalledRow}>
                <Text style={styles.recalledText}>{label}</Text>
              </View>
            );
          }
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
          const recallable = canRecallMessage(
            item,
            myId,
            conversationType,
            myGroupRole,
          );
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
                <Pressable
                  accessible
                  accessibilityHint={recallable ? '长按打开消息操作' : undefined}
                  delayLongPress={350}
                  onLongPress={recallable ? () => {
                    if (canRecallMessage(item, myId, conversationType, myGroupRole)) {
                      setSelectedMessage(item);
                    }
                  } : undefined}
                  style={({ pressed }) => [
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubblePeer,
                    pressed && recallable && styles.bubblePressed,
                  ]}
                >
                  <MentionText body={item.body} />
                </Pressable>
                {conversationType === 'SINGLE' && mine && item.seq != null ? (
                  <Text style={styles.deliveryStatus}>
                    {peerReadSeq != null && item.seq <= peerReadSeq ? '已读' : '已发送'}
                  </Text>
                ) : null}
              </View>
              {item.status === 'sending' || item.status === 'acked' || recallingSeq === item.seq ? (
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
            ref={inputRef}
            style={styles.input}
            placeholder="说点什么"
            placeholderTextColor={COLORS.textMuted}
            value={draft.text}
            selection={draftSelection}
            onChangeText={changeDraftText}
            onSelectionChange={(event) => setDraftSelection(event.nativeEvent.selection)}
            onSubmitEditing={() => void send()}
          />
          <IconButton
            name="send"
            accessibilityLabel="发送"
            disabled={draft.text.trim() === ''}
            color={COLORS.white}
            backgroundColor={draft.text.trim() === '' ? COLORS.textMuted : COLORS.primary}
            onPress={() => void send()}
          />
        </View>
      </SafeAreaView>
      <MessageActionSheet
        visible={selectedMessage != null}
        onClose={() => setSelectedMessage(null)}
        onRecall={() => void recallSelected()}
      />
      <MentionPickerSheet
        visible={mentionPickerVisible}
        members={groupMembers}
        myId={myId}
        myRole={myGroupRole}
        excludedUserIds={excludedMentionUserIds}
        onClose={closeMentionPicker}
        onConfirm={confirmMentionSelection}
      />
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
  bubbleMine: { backgroundColor: COLORS.successSoft },
  bubblePeer: { backgroundColor: COLORS.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  bubblePressed: { opacity: 0.72 },
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
  recalledRow: { alignItems: 'center', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xs },
  recalledText: {
    color: COLORS.textMuted,
    fontSize: TYPE.caption,
    fontStyle: 'italic',
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
