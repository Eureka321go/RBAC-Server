import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { GroupDetail, GroupMember } from '@im/sdk-core';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import { UserMultiSelect } from '../components/UserMultiSelect';
import type { RootStackParamList } from '../navigation/types';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { listSelectableUsers, type SelectableUser } from '../services/users';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupDetails'>;

function roleLabel(role: GroupMember['role']): string {
  if (role === 'OWNER') return '群主';
  if (role === 'ADMIN') return '管理员';
  return '成员';
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败';
}

function parseUserIds(value: string): number[] {
  return value
    .split(/[\s,，]+/)
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export function GroupDetailsScreen({ route, navigation }: Props) {
  const { cid, groupId } = route.params;
  const myId = useAppStore((state) => state.myId);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [users, setUsers] = useState<SelectableUser[]>([]);
  const [nameDraft, setNameDraft] = useState(route.params.title);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [manualMemberIds, setManualMemberIds] = useState('');
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingGroupAction, setPendingGroupAction] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextDetail, nextMembers] = await Promise.all([
        sdk.groups.getGroup(groupId),
        sdk.groups.getMembers(groupId),
      ]);
      if (!mountedRef.current) return;
      setDetail(nextDetail);
      setMembers(nextMembers);
      setNameDraft(nextDetail.name);
      setError(null);
    } catch (cause) {
      if (mountedRef.current) setError(`群资料刷新失败：${errorMessage(cause)}`);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [groupId]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    void listSelectableUsers(myId).then((items) => {
      if (mountedRef.current) setUsers(items);
    }).catch(() => {
      // 成员管理仍可按 userId 展示；仅添加成员选择器不可用。
    });
    const offMessage = sdk.chat.on('message', (payload) => {
      if (payload.cid === cid && payload.type === 'SYSTEM') void load();
    });
    return () => {
      mountedRef.current = false;
      offMessage();
    };
  }, [cid, load, myId]);

  const namesById = useMemo(
    () => new Map(users.map((user) => [user.id, user.nickname?.trim() || user.username])),
    [users],
  );
  const existingMemberIds = useMemo(
    () => new Set(members.map((member) => member.userId)),
    [members],
  );
  const addMemberIds = useMemo(() => {
    const ids = new Set([...selectedIds, ...parseUserIds(manualMemberIds)]);
    existingMemberIds.forEach((id) => ids.delete(id));
    return [...ids];
  }, [existingMemberIds, manualMemberIds, selectedIds]);
  const canManage = detail?.myRole === 'OWNER' || detail?.myRole === 'ADMIN';
  const isOwner = detail?.myRole === 'OWNER';

  const runGroupAction = async (key: string, action: () => Promise<void>) => {
    setPendingGroupAction(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      if (mountedRef.current) {
        const message = `操作失败：${errorMessage(cause)}`;
        await load();
        if (mountedRef.current) setError(message);
      }
    } finally {
      if (mountedRef.current) setPendingGroupAction(null);
    }
  };

  const runMemberAction = async (userId: number, action: () => Promise<void>) => {
    setPendingMemberId(userId);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      if (mountedRef.current) {
        const message = `成员操作失败：${errorMessage(cause)}`;
        await load();
        if (mountedRef.current) setError(message);
      }
    } finally {
      if (mountedRef.current) setPendingMemberId(null);
    }
  };

  const rename = async () => {
    const normalized = nameDraft.trim();
    if (normalized === '' || normalized === detail?.name) return;
    await runGroupAction('rename', async () => {
      await sdk.groups.renameGroup(groupId, normalized);
      await sdk.sync.setConversationDisplayName(cid, normalized);
    });
  };

  const addMembers = async () => {
    if (addMemberIds.length === 0) return;
    await runGroupAction('add', async () => {
      await sdk.groups.addMembers(groupId, addMemberIds);
      setSelectedIds(new Set());
      setManualMemberIds('');
      setShowAddMembers(false);
    });
  };

  const leaveOrDissolve = (dissolve: boolean) => {
    Alert.alert(
      dissolve ? '解散群聊' : '退出群聊',
      dissolve ? '群聊解散后所有成员都将无法继续使用该会话。' : '退出后将从本地移除此群聊。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: dissolve ? '确认解散' : '确认退出',
          style: 'destructive',
          onPress: () => void (async () => {
            setPendingGroupAction(dissolve ? 'dissolve' : 'leave');
            try {
              if (dissolve) await sdk.groups.dissolveGroup(groupId);
              else await sdk.groups.leaveGroup(groupId);
              await sdk.sync.removeLocalConversation(cid);
              navigation.reset({ index: 0, routes: [{ name: 'Conversations' }] });
              void sdk.sync.syncAll().catch(() => {});
            } catch (cause) {
              if (mountedRef.current) {
                const message = `操作失败：${errorMessage(cause)}`;
                setPendingGroupAction(null);
                await load();
                if (mountedRef.current) setError(message);
              }
            }
          })(),
        },
      ],
    );
  };

  const transferOwner = (member: GroupMember) => {
    Alert.alert('转让群主', `确认将群主转让给用户 #${member.userId}？转让后你将成为普通成员。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '确认转让',
        style: 'destructive',
        onPress: () => void runMemberAction(
          member.userId,
          () => sdk.groups.transferOwner(groupId, member.userId),
        ),
      },
    ]);
  };

  if (detail == null && refreshing) {
    return (
      <View style={styles.page}>
        <CompactScreenHeader title={route.params.title} onBack={() => navigation.goBack()} />
        <ActivityIndicator style={styles.centerLoader} />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <CompactScreenHeader title={detail?.name ?? route.params.title} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>群资料</Text>
          <Text style={styles.meta}>群号 #{groupId} · {detail?.memberCount ?? members.length} 人 · {detail ? roleLabel(detail.myRole) : ''}</Text>
          {canManage ? (
            <View style={styles.inlineForm}>
              <TextInput
                style={[styles.input, styles.flex]}
                maxLength={100}
                editable={pendingGroupAction == null}
                value={nameDraft}
                onChangeText={setNameDraft}
              />
              <Button
                title="改名"
                disabled={pendingGroupAction != null || nameDraft.trim() === '' || nameDraft.trim() === detail?.name}
                onPress={() => void rename()}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.cardTitle}>群成员</Text>
            {canManage ? (
              <Pressable style={styles.primarySmall} onPress={() => setShowAddMembers(true)}>
                <Text style={styles.primarySmallText}>添加成员</Text>
              </Pressable>
            ) : null}
          </View>
          {members.map((member) => {
            const isMe = member.userId === myId;
            const targetIsMember = member.role === 'MEMBER';
            const canAdminManageTarget = detail?.myRole === 'ADMIN' && targetIsMember;
            const canOwnerManageTarget = isOwner && member.role !== 'OWNER';
            const canKick = !isMe && (canOwnerManageTarget || canAdminManageTarget);
            const canMute = !isMe && targetIsMember && canManage;
            const busy = pendingMemberId === member.userId;
            return (
              <View key={member.userId} style={styles.memberRow}>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>
                    {isMe ? '我' : namesById.get(member.userId) ?? `用户 #${member.userId}`}
                  </Text>
                  <Text style={styles.memberMeta}>
                    {roleLabel(member.role)}{member.muted ? ' · 已禁言' : ''}
                  </Text>
                </View>
                {busy ? <ActivityIndicator size="small" /> : (
                  <View style={styles.memberActions}>
                    {isOwner && targetIsMember ? (
                      <Pressable onPress={() => void runMemberAction(member.userId, () => sdk.groups.setMemberRole(groupId, member.userId, 'ADMIN'))}>
                        <Text style={styles.action}>设管理</Text>
                      </Pressable>
                    ) : null}
                    {isOwner && member.role === 'ADMIN' ? (
                      <Pressable onPress={() => void runMemberAction(member.userId, () => sdk.groups.setMemberRole(groupId, member.userId, 'MEMBER'))}>
                        <Text style={styles.action}>免管理</Text>
                      </Pressable>
                    ) : null}
                    {canMute ? (
                      <Pressable onPress={() => void runMemberAction(member.userId, () => sdk.groups.setMemberMuted(groupId, member.userId, !member.muted))}>
                        <Text style={styles.action}>{member.muted ? '解禁' : '禁言'}</Text>
                      </Pressable>
                    ) : null}
                    {isOwner && !isMe ? (
                      <Pressable onPress={() => transferOwner(member)}>
                        <Text style={styles.action}>转群主</Text>
                      </Pressable>
                    ) : null}
                    {canKick ? (
                      <Pressable onPress={() => Alert.alert('移出成员', `确认将用户 #${member.userId} 移出群聊？`, [
                        { text: '取消', style: 'cancel' },
                        { text: '移出', style: 'destructive', onPress: () => void runMemberAction(member.userId, () => sdk.groups.removeMember(groupId, member.userId)) },
                      ])}>
                        <Text style={styles.dangerAction}>移出</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {detail ? (
          <Pressable
            disabled={pendingGroupAction != null}
            style={[styles.dangerButton, pendingGroupAction != null && styles.disabled]}
            onPress={() => leaveOrDissolve(isOwner)}
          >
            <Text style={styles.dangerButtonText}>{isOwner ? '解散群聊' : '退出群聊'}</Text>
          </Pressable>
        ) : (
          <Button title="重试加载群资料" disabled={refreshing} onPress={() => void load()} />
        )}
      </ScrollView>

      <Modal
        visible={showAddMembers}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddMembers(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>添加群成员</Text>
            <View style={styles.selector}>
              <UserMultiSelect
                users={users}
                selectedIds={selectedIds}
                disabledIds={existingMemberIds}
                disabled={pendingGroupAction != null}
                onToggle={(userId) => setSelectedIds((current) => {
                  const next = new Set(current);
                  if (next.has(userId)) next.delete(userId);
                  else next.add(userId);
                  return next;
                })}
              />
            </View>
            <TextInput
              style={styles.input}
              placeholder="补充成员 userId，如 2, 3"
              editable={pendingGroupAction == null}
              value={manualMemberIds}
              onChangeText={setManualMemberIds}
            />
            <View style={styles.modalActions}>
              <Button title="取消" onPress={() => setShowAddMembers(false)} />
              <Button
                title={`添加（${addMemberIds.length}）`}
                disabled={addMemberIds.length === 0 || pendingGroupAction != null}
                onPress={() => void addMembers()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  centerLoader: { marginTop: 64 },
  error: { color: '#b91c1c', backgroundColor: '#fee2e2', padding: 10, borderRadius: 8 },
  card: { padding: 14, borderRadius: 12, backgroundColor: '#ffffff', gap: 10 },
  cardTitle: { color: '#0f172a', fontSize: 17, fontWeight: '700' },
  meta: { color: '#64748b', fontSize: 13 },
  inlineForm: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  flex: { flex: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  primarySmall: { backgroundColor: '#2563eb', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  primarySmallText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  memberRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0' },
  memberInfo: { flex: 1 },
  memberName: { color: '#0f172a', fontSize: 15, fontWeight: '600' },
  memberMeta: { color: '#64748b', fontSize: 12, marginTop: 3 },
  memberActions: { maxWidth: '58%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 },
  action: { color: '#2563eb', fontSize: 12, fontWeight: '600' },
  dangerAction: { color: '#dc2626', fontSize: 12, fontWeight: '600' },
  dangerButton: { alignItems: 'center', padding: 13, borderRadius: 10, backgroundColor: '#fee2e2' },
  dangerButtonText: { color: '#b91c1c', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.35)' },
  modalCard: { height: '70%', padding: 16, gap: 12, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#ffffff' },
  modalTitle: { color: '#0f172a', fontSize: 18, fontWeight: '700' },
  selector: { flex: 1 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
});
