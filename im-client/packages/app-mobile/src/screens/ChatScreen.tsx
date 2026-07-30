import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import {
  buildMessageQuote,
  canQuoteMessage,
  normalizeMessageQuote,
  type ChatMessage,
  type GroupMember,
  type GroupRole,
  type MessageQuote,
} from '@im/sdk-core';
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
import { AttachmentPickerSheet } from '../components/AttachmentPickerSheet';
import { MediaMessageContent } from '../components/MediaMessageContent';
import { ImagePreviewModal } from '../components/ImagePreviewModal';
import { VoiceComposerControl } from '../components/VoiceComposerControl';
import { VoiceMessageContent } from '../components/VoiceMessageContent';
import { VoiceRecordingOverlay } from '../components/VoiceRecordingOverlay';
import { LinkCardContent } from '../components/LinkCardContent';
import { MessageQuoteContent } from '../components/MessageQuoteContent';
import { useVoiceRecording } from '../voice/useVoiceRecording';
import {
  voiceMessageKey,
  voicePlaybackCoordinator,
} from '../voice/voicePlaybackCoordinator';
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
    case 'QUOTE_TARGET_INVALID': return '引用的消息信息无效';
    case 'QUOTE_TARGET_NOT_FOUND': return '引用的原消息不存在';
    case 'QUOTE_TARGET_RECALLED': return '引用的原消息已撤回';
    case 'QUOTE_TARGET_UNSUPPORTED': return '这类消息暂不支持引用';
    default: return `发送失败：${reason}`;
  }
}

function mediaErrorText(reason?: string): string {
  switch (reason) {
    case 'MEDIA_TOO_LARGE': return '文件超过大小上限';
    case 'MEDIA_INVALID': return '无法读取所选文件';
    case 'CAMERA_PERMISSION_DENIED': return '请先允许应用使用相机';
    case 'PHOTO_PERMISSION_DENIED': return '请先允许应用访问相册';
    case 'CAMERA_FAILED': return '拍照失败，请稍后重试';
    case 'PHOTO_PICK_FAILED': return '选择图片失败，请稍后重试';
    case 'UPLOAD_SOURCE_MISSING': return '本地文件已不存在，请重新选择';
    case 'UPLOAD_SESSION_EXPIRED': return '上传会话已过期，请点击重试';
    case 'NO_FILE_HANDLER': return '设备上没有可打开此文件的应用';
    case 'NOT_AUTHENTICATED': return '登录状态已失效，请重新登录';
    default:
      if (reason?.startsWith('DOWNLOAD_HTTP_')) return '文件下载失败，请稍后重试';
      if (reason?.startsWith('UPLOAD_HTTP_')) return '文件上传失败，请点击重试';
      return '富媒体操作失败，请稍后重试';
  }
}

function voiceErrorText(reason?: string): string {
  switch (reason) {
    case 'VOICE_PERMISSION_DENIED': return '请允许应用使用麦克风后再录音';
    case 'VOICE_PERMISSION_BLOCKED': return '麦克风权限已关闭，请前往系统设置开启';
    case 'VOICE_PERMISSION_UNAVAILABLE': return '当前设备无法使用麦克风';
    case 'VOICE_TOO_SHORT': return '说话时间太短';
    case 'VOICE_METERING_MISSING': return '没有检测到有效声音，请重试';
    case 'VOICE_RECORDING_BUSY': return '正在处理上一段录音，请稍候';
    case 'VOICE_RECORDING_FAILED': return '录音失败，请稍后重试';
    case 'VOICE_METADATA_INVALID': return '语音信息不完整，无法发送';
    case 'VOICE_PLAYBACK_FAILED': return '语音播放失败，请重试';
    default: return mediaErrorText(reason);
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
  const [quoteDraft, setQuoteDraft] = useState<MessageQuote | null>(null);
  const [highlightedSeq, setHighlightedSeq] = useState<number | null>(null);
  const [recallingSeq, setRecallingSeq] = useState<number | null>(null);
  const [attachmentPickerVisible, setAttachmentPickerVisible] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [downloadingObjectKey, setDownloadingObjectKey] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [voiceMode, setVoiceMode] = useState(false);
  const [heardVoiceSeqs, setHeardVoiceSeqs] = useState<Set<number>>(() => new Set());

  // 组件是否仍处于挂载状态；卸载后用它守卫所有异步回调里的 setState，避免对已卸载组件调用。
  const mountedRef = useRef(true);
  // 页面实例复用到另一个 cid 时，旧会话尚未结束的异步读取不得污染新会话。
  const activeCidRef = useRef(cid);
  activeCidRef.current = cid;
  // 横幅自动消失的定时器；每次新错误到来时需要清掉旧的，重新计时 3 秒。
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteScrollTargetRef = useRef<number | null>(null);
  const quoteScrollRetryCountRef = useRef(0);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

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
    const [list, readState, heardSeqs] = await Promise.all([
      sdk.chat.getChatMessages(cid),
      sdk.chat.getReadState(cid),
      myId == null ? Promise.resolve(new Set<number>()) : sdk.voice.heard.listHeardSeqs(myId, cid),
    ]);
    if (!mountedRef.current || activeCidRef.current !== cid) return;
    setItems(list);
    setHeardVoiceSeqs(heardSeqs);
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
  }, [cid, myId, showBanner]);

  const safeReload = useCallback(() => {
    void reload().catch((cause) => {
      if (mountedRef.current && activeCidRef.current === cid) {
        showBanner(`刷新失败：${cause instanceof Error ? cause.message : 'unknown'}`);
      }
    });
  }, [cid, reload, showBanner]);

  const reloadHeardVoiceSeqs = useCallback(() => {
    if (myId == null) {
      setHeardVoiceSeqs(new Set());
      return;
    }
    void sdk.voice.heard.listHeardSeqs(myId, cid).then((seqs) => {
      if (mountedRef.current && activeCidRef.current === cid) setHeardVoiceSeqs(seqs);
    }).catch(() => {});
  }, [cid, myId]);

  const showVoiceError = useCallback((reason: string) => {
    showBanner(voiceErrorText(reason));
  }, [showBanner]);

  const voiceRecording = useVoiceRecording({
    cid,
    onEnqueued: safeReload,
    onError: showVoiceError,
  });

  useFocusEffect(useCallback(() => () => {
    void voiceRecording.cancel();
    void voicePlaybackCoordinator.pause();
  }, [voiceRecording.cancel]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        void voiceRecording.cancel();
        void voicePlaybackCoordinator.pause();
      }
    });
    return () => subscription.remove();
  }, [voiceRecording.cancel]);

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
    setQuoteDraft(null);
    setHighlightedSeq(null);
    quoteScrollTargetRef.current = null;
    quoteScrollRetryCountRef.current = 0;
    setRecallingSeq(null);
    setDraft(emptyMentionDraft());
    setDraftSelection({ start: 0, end: 0 });
    setMentionTrigger(null);
    setMentionPickerVisible(false);
    setAttachmentPickerVisible(false);
    setPreviewUri(null);
    setDownloadingObjectKey(null);
    setDownloadProgress(0);
    setVoiceMode(false);
    setHeardVoiceSeqs(new Set());
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
      if (highlightTimerRef.current != null) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      if (scrollRetryTimerRef.current != null) {
        clearTimeout(scrollRetryTimerRef.current);
        scrollRetryTimerRef.current = null;
      }
      offMsg();
      offRead();
      offConnection();
      offErr();
      offRecall();
      void voiceRecording.cancel();
      void voicePlaybackCoordinator.stop();
    };
  }, [cid, safeReload, showBanner, syncOnOpen, voiceRecording.cancel]);

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

  const locateQuotedMessage = useCallback((targetSeq: number) => {
    const index = data.findIndex((message) => message.seq === targetSeq);
    if (index < 0) {
      showBanner('原消息暂未加载');
      return;
    }
    quoteScrollTargetRef.current = index;
    quoteScrollRetryCountRef.current = 0;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setHighlightedSeq(targetSeq);
    if (highlightTimerRef.current != null) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      highlightTimerRef.current = null;
      if (mountedRef.current) setHighlightedSeq(null);
    }, 1600);
  }, [data, showBanner]);

  const retryQuotedMessageScroll = useCallback((info: {
    index: number;
    averageItemLength: number;
  }) => {
    if (quoteScrollTargetRef.current !== info.index) return;
    if (quoteScrollRetryCountRef.current >= 1 || info.averageItemLength <= 0) {
      quoteScrollTargetRef.current = null;
      showBanner('原消息暂未加载');
      return;
    }
    quoteScrollRetryCountRef.current += 1;
    listRef.current?.scrollToOffset({
      offset: info.averageItemLength * info.index,
      animated: false,
    });
    if (scrollRetryTimerRef.current != null) clearTimeout(scrollRetryTimerRef.current);
    scrollRetryTimerRef.current = setTimeout(() => {
      scrollRetryTimerRef.current = null;
      if (quoteScrollTargetRef.current !== info.index) return;
      listRef.current?.scrollToIndex({
        index: info.index,
        animated: true,
        viewPosition: 0.5,
      });
      quoteScrollTargetRef.current = null;
    }, 100);
  }, [showBanner]);

  useEffect(() => {
    const activeKey = voicePlaybackCoordinator.getSnapshot().key;
    if (activeKey == null) return;
    const activeMessage = items.find((item) => item.type === 'AUDIO'
      && voiceMessageKey(item) === activeKey);
    if (activeMessage?.recalled) void voicePlaybackCoordinator.stop();
  }, [items]);

  const send = useCallback(async () => {
    const { text } = draft;
    if (text.trim() === '') return;
    const options = {
      ...toSendTextOptions(draft),
      quote: quoteDraft ?? undefined,
    };
    await sdk.chat.sendText(cid, text, options);
    setDraft(emptyMentionDraft());
    setDraftSelection({ start: 0, end: 0 });
    setMentionTrigger(null);
    setMentionPickerVisible(false);
    setQuoteDraft(null);
  }, [cid, draft, quoteDraft]);

  const toggleVoiceMode = useCallback(async () => {
    if (voiceMode) {
      setVoiceMode(false);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    let permission;
    try {
      permission = await voiceRecording.ensurePermission();
    } catch {
      showVoiceError('VOICE_PERMISSION_UNAVAILABLE');
      return;
    }
    if (permission === 'granted') {
      inputRef.current?.blur();
      setVoiceMode(true);
      return;
    }
    if (permission === 'blocked') {
      Alert.alert(
        '需要麦克风权限',
        voiceErrorText('VOICE_PERMISSION_BLOCKED'),
        [
          { text: '取消', style: 'cancel' },
          { text: '前往设置', onPress: () => void sdk.voice.permission.openSettings() },
        ],
      );
      return;
    }
    showVoiceError(`VOICE_PERMISSION_${permission.toUpperCase()}`);
  }, [showVoiceError, voiceMode, voiceRecording.ensurePermission]);

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

  const senderNameForMessage = useCallback((message: ChatMessage): string => {
    const mine = message.senderId === myId;
    if (mine) {
      return myDisplayName?.trim() || (myId == null ? '我' : `用户 #${myId}`);
    }
    if (conversationType === 'GROUP') {
      return message.senderId == null
        ? '未知用户'
        : namesById.get(message.senderId)?.trim() || `用户 #${message.senderId}`;
    }
    return displayTitle;
  }, [conversationType, displayTitle, myDisplayName, myId, namesById]);

  const quoteSelected = useCallback(() => {
    const message = selectedMessage;
    if (message == null) return;
    const quote = buildMessageQuote(message, senderNameForMessage(message));
    setSelectedMessage(null);
    if (quote == null) {
      showBanner('这条消息当前不能引用');
      return;
    }
    setQuoteDraft(quote);
  }, [selectedMessage, senderNameForMessage, showBanner]);

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

  const selectAttachment = useCallback(async (kind: 'camera' | 'library' | 'file') => {
    setAttachmentPickerVisible(false);
    try {
      const picked = kind === 'camera'
        ? await sdk.media.pickCameraImage()
        : kind === 'library'
          ? await sdk.media.pickLibraryImage()
          : await sdk.media.pickFile();
      if (picked == null) return;
      await sdk.media.enqueue(cid, kind === 'file' ? 'FILE' : 'IMAGE', picked);
      safeReload();
    } catch (cause) {
      showBanner(mediaErrorText(cause instanceof Error ? cause.message : undefined));
    }
  }, [cid, safeReload, showBanner]);

  const retryMessage = useCallback(async (message: ChatMessage) => {
    const uploadTaskId = message.body?.uploadTaskId;
    try {
      if (typeof uploadTaskId === 'string') {
        await sdk.media.retry(uploadTaskId);
      } else if (message.clientMsgId != null) {
        await sdk.chat.resend(message.clientMsgId);
      }
      safeReload();
    } catch (cause) {
      showBanner(mediaErrorText(cause instanceof Error ? cause.message : undefined));
    }
  }, [safeReload, showBanner]);

  const cancelUpload = useCallback(async (message: ChatMessage) => {
    const uploadTaskId = message.body?.uploadTaskId;
    if (typeof uploadTaskId !== 'string') return;
    try {
      await sdk.media.cancel(uploadTaskId);
      safeReload();
    } catch (cause) {
      showBanner(mediaErrorText(cause instanceof Error ? cause.message : undefined));
    }
  }, [safeReload, showBanner]);

  const refreshImageUrl = useCallback((objectKey: string, filename: string) => (
    sdk.media.downloadToCache(cid, objectKey, filename)
  ), [cid]);

  const openFile = useCallback(async (message: ChatMessage) => {
    const objectKey = message.body?.objectKey;
    const filename = message.body?.filename;
    const mime = message.body?.mime;
    if (typeof objectKey !== 'string' || typeof filename !== 'string' || typeof mime !== 'string') {
      showBanner('文件信息不完整，无法打开');
      return;
    }
    setDownloadingObjectKey(objectKey);
    setDownloadProgress(0);
    try {
      await sdk.media.downloadAndOpen(
        cid,
        objectKey,
        filename,
        mime,
        (done, total) => {
          if (!mountedRef.current || total <= 0) return;
          setDownloadProgress(Math.max(0, Math.min(1, done / total)));
        },
      );
    } catch (cause) {
      showBanner(mediaErrorText(cause instanceof Error ? cause.message : undefined));
    } finally {
      if (mountedRef.current) {
        setDownloadingObjectKey(null);
        setDownloadProgress(0);
      }
    }
  }, [cid, showBanner]);

  return (
    <View style={styles.wrap}>
      <CompactScreenHeader
        title={displayTitle}
        onBack={() => navigation.goBack()}
        rightIcon="settings-outline"
        rightAccessibilityLabel={conversationType === 'GROUP' ? '群设置' : '会话设置'}
        onRightPress={() => {
          if (conversationType === 'GROUP') {
            if (groupId != null) {
              navigation.navigate('GroupDetails', { cid, groupId, title: displayTitle });
            }
            return;
          }
          navigation.navigate('ConversationSettings', { cid, title: displayTitle });
        }}
      />
      {banner ? <View style={styles.banner}><StatusNotice message={banner} tone="error" /></View> : null}
      <FlatList
        ref={listRef}
        inverted
        contentContainerStyle={styles.messageList}
        data={data}
        keyExtractor={(m) => (m.seq != null ? `s:${m.seq}` : `c:${m.clientMsgId}`)}
        onScrollToIndexFailed={retryQuotedMessageScroll}
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
          const quotable = canQuoteMessage(item);
          const actionable = recallable || quotable;
          const messageQuote = item.type === 'TEXT'
            ? normalizeMessageQuote(item.body?.quote)
            : null;
          const openMessageActions = actionable ? () => {
            if (canQuoteMessage(item)
              || canRecallMessage(item, myId, conversationType, myGroupRole)) {
              setSelectedMessage(item);
            }
          } : undefined;
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
                  accessibilityHint={actionable ? '长按打开消息操作' : undefined}
                  delayLongPress={350}
                  onLongPress={openMessageActions}
                  style={({ pressed }) => [
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubblePeer,
                    item.type === 'IMAGE' && styles.imageBubble,
                    item.seq === highlightedSeq && styles.bubbleHighlighted,
                    pressed && actionable && styles.bubblePressed,
                  ]}
                >
                  {item.type === 'AUDIO' && myId != null ? (
                    <VoiceMessageContent
                      message={item}
                      accountId={myId}
                      mine={mine}
                      heard={item.seq != null && heardVoiceSeqs.has(item.seq)}
                      onHeard={reloadHeardVoiceSeqs}
                      onError={showVoiceError}
                      onLongPress={openMessageActions}
                    />
                  ) : item.type === 'IMAGE' || item.type === 'FILE' ? (
                    <MediaMessageContent
                      message={item}
                      onPreview={setPreviewUri}
                      onRefreshImage={refreshImageUrl}
                      onOpenFile={(message) => void openFile(message)}
                      onLongPress={openMessageActions}
                      downloading={item.body?.objectKey === downloadingObjectKey}
                      downloadProgress={downloadProgress}
                    />
                  ) : (
                    <View>
                      {messageQuote == null ? null : (
                        <MessageQuoteContent
                          quote={messageQuote}
                          mode="message"
                          recalled={recallOperators.has(messageQuote.targetSeq)}
                          onPress={() => locateQuotedMessage(messageQuote.targetSeq)}
                          onLongPress={openMessageActions}
                        />
                      )}
                      <MentionText body={item.body} />
                      {item.type === 'TEXT' ? (
                        <LinkCardContent
                          body={item.body}
                          onLongPress={openMessageActions}
                          onOpenError={() => showBanner('无法打开此链接')}
                        />
                      ) : null}
                    </View>
                  )}
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
              {item.status === 'uploading' && typeof item.body?.uploadTaskId === 'string' ? (
                <IconButton
                  name="close-circle-outline"
                  accessibilityLabel="取消上传"
                  color={COLORS.textSecondary}
                  onPress={() => void cancelUpload(item)}
                />
              ) : null}
              {item.status === 'failed' && item.clientMsgId ? (
                <IconButton
                  name="alert-circle"
                  accessibilityLabel="重新发送"
                  color={COLORS.danger}
                  onPress={() => void retryMessage(item)}
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
        {quoteDraft == null ? null : (
          <MessageQuoteContent
            quote={quoteDraft}
            mode="composer"
            onClose={() => setQuoteDraft(null)}
          />
        )}
        <View style={styles.composer}>
          <IconButton
            name="add-circle-outline"
            accessibilityLabel="添加图片或文件"
            disabled={voiceRecording.state.active || voiceRecording.state.starting}
            color={COLORS.primary}
            onPress={() => setAttachmentPickerVisible(true)}
          />
          <VoiceComposerControl
            voiceMode={voiceMode}
            disabled={false}
            active={voiceRecording.state.active || voiceRecording.state.starting}
            onToggleMode={() => void toggleVoiceMode()}
            onStart={voiceRecording.start}
            onCancellingChange={voiceRecording.setCancelling}
            onFinish={voiceRecording.finish}
          />
          {!voiceMode ? (
            <>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="说点什么"
                placeholderTextColor={COLORS.textMuted}
                value={draft.text}
                selection={draftSelection}
                editable={!voiceRecording.state.active && !voiceRecording.state.starting}
                onChangeText={changeDraftText}
                onSelectionChange={(event) => setDraftSelection(event.nativeEvent.selection)}
                onSubmitEditing={() => void send()}
              />
              <IconButton
                name="send"
                accessibilityLabel="发送"
                disabled={draft.text.trim() === ''
                  || voiceRecording.state.active
                  || voiceRecording.state.starting}
                color={COLORS.white}
                backgroundColor={draft.text.trim() === '' ? COLORS.textMuted : COLORS.primary}
                onPress={() => void send()}
              />
            </>
          ) : null}
        </View>
      </SafeAreaView>
      <MessageActionSheet
        visible={selectedMessage != null}
        canQuote={selectedMessage != null && canQuoteMessage(selectedMessage)}
        canRecall={selectedMessage != null && canRecallMessage(
          selectedMessage,
          myId,
          conversationType,
          myGroupRole,
        )}
        onClose={() => setSelectedMessage(null)}
        onQuote={quoteSelected}
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
      <AttachmentPickerSheet
        visible={attachmentPickerVisible}
        onClose={() => setAttachmentPickerVisible(false)}
        onSelect={(kind) => void selectAttachment(kind)}
      />
      <ImagePreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />
      <VoiceRecordingOverlay {...voiceRecording.state} />
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
  imageBubble: { paddingHorizontal: 2, paddingVertical: 2 },
  bubbleMine: { backgroundColor: COLORS.messageMine },
  bubblePeer: { backgroundColor: COLORS.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  bubbleHighlighted: { borderWidth: 2, borderColor: COLORS.primary },
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
