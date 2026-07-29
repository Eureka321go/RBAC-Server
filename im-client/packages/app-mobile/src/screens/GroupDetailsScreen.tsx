import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons/static';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { GroupDetail, GroupMember } from '@im/sdk-core';
import { AppButton } from '../components/AppButton';
import { AppTextField } from '../components/AppTextField';
import { GroupAvatar, InitialAvatar } from '../components/Avatar';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import { DepartmentContactPicker } from '../components/DepartmentContactPicker';
import { IconButton } from '../components/IconButton';
import { StatusNotice } from '../components/StatusNotice';
import { Surface } from '../components/Surface';
import { buildContactDirectory, type ContactDirectoryModel } from '../contact/directory';
import type { RootStackParamList } from '../navigation/types';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

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

interface ActionRowProps {
  icon: IoniconsIconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

function ActionRow({ icon, label, onPress, danger = false }: ActionRowProps) {
  const color = danger ? COLORS.danger : COLORS.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
    >
      <View style={[styles.actionIcon, danger && styles.actionIconDanger]}>
        <Ionicons name={icon} size={21} color={color} />
      </View>
      <Text style={[styles.actionLabel, danger && styles.actionLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

export function GroupDetailsScreen({ route, navigation }: Props) {
  const { cid, groupId } = route.params;
  const myId = useAppStore((state) => state.myId);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [directory, setDirectory] = useState<ContactDirectoryModel | null>(null);
  const [nameDraft, setNameDraft] = useState(route.params.title);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [manualMemberIds, setManualMemberIds] = useState('');
  const [showRename, setShowRename] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [selectedMember, setSelectedMember] = useState<GroupMember | null>(null);
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
    void sdk.contacts.getDirectory().then((result) => {
      if (mountedRef.current) setDirectory(buildContactDirectory(result));
    }).catch(() => {
      // 群成员接口自带 displayName；通讯录失败时仍可按 userId 手工添加。
    });
    const offMessage = sdk.chat.on('message', (payload) => {
      if (payload.cid === cid && payload.type === 'SYSTEM') void load();
    });
    return () => {
      mountedRef.current = false;
      offMessage();
    };
  }, [cid, load]);

  const namesById = useMemo(
    () => directory?.namesById ?? new Map<number, string>(),
    [directory],
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

  const displayNameOf = useCallback((member: GroupMember): string => {
    if (member.userId === myId) return '我';
    return member.displayName?.trim() || namesById.get(member.userId) || `用户 #${member.userId}`;
  }, [myId, namesById]);

  const canManageMember = useCallback((member: GroupMember): boolean => {
    if (member.userId === myId) return false;
    if (isOwner) return member.role !== 'OWNER';
    return detail?.myRole === 'ADMIN' && member.role === 'MEMBER';
  }, [detail?.myRole, isOwner, myId]);

  const runGroupAction = async (key: string, action: () => Promise<void>): Promise<boolean> => {
    setPendingGroupAction(key);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (cause) {
      if (mountedRef.current) {
        const message = `操作失败：${errorMessage(cause)}`;
        await load();
        if (mountedRef.current) setError(message);
      }
      return false;
    } finally {
      if (mountedRef.current) setPendingGroupAction(null);
    }
  };

  const runMemberAction = async (userId: number, action: () => Promise<void>) => {
    setSelectedMember(null);
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
    const succeeded = await runGroupAction('rename', async () => {
      await sdk.groups.renameGroup(groupId, normalized);
      await sdk.sync.setConversationDisplayName(cid, normalized);
    });
    if (succeeded && mountedRef.current) setShowRename(false);
  };

  const addMembers = async () => {
    if (addMemberIds.length === 0) return;
    const succeeded = await runGroupAction('add', () => sdk.groups.addMembers(groupId, addMemberIds));
    if (!succeeded || !mountedRef.current) return;
    setSelectedIds(new Set());
    setManualMemberIds('');
    setShowAddMembers(false);
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
    setSelectedMember(null);
    Alert.alert('转让群主', `确认将群主转让给${displayNameOf(member)}？转让后你将成为普通成员。`, [
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

  const removeMember = (member: GroupMember) => {
    setSelectedMember(null);
    Alert.alert('移出成员', `确认将${displayNameOf(member)}移出群聊？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移出',
        style: 'destructive',
        onPress: () => void runMemberAction(
          member.userId,
          () => sdk.groups.removeMember(groupId, member.userId),
        ),
      },
    ]);
  };

  if (detail == null && refreshing) {
    return (
      <View style={styles.page}>
        <CompactScreenHeader title={route.params.title} onBack={() => navigation.goBack()} />
        <ActivityIndicator style={styles.centerLoader} color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <CompactScreenHeader title="群设置" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={COLORS.primary} />}
      >
        {error ? <StatusNotice message={error} tone="error" /> : null}

        <View style={styles.hero}>
          <GroupAvatar size={88} />
          <Text style={styles.groupName}>{detail?.name ?? route.params.title}</Text>
          <Text style={styles.groupMeta}>
            群号 #{groupId} · {detail?.memberCount ?? members.length} 人 · {detail ? roleLabel(detail.myRole) : ''}
          </Text>
        </View>

        {canManage ? (
          <Surface>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setNameDraft(detail?.name ?? route.params.title);
                setShowRename(true);
              }}
              style={({ pressed }) => [styles.settingRow, pressed && styles.rowPressed]}
            >
              <View style={styles.settingLabelWrap}>
                <Ionicons name="pencil-outline" size={20} color={COLORS.primary} />
                <Text style={styles.settingLabel}>群名称</Text>
              </View>
              <Text style={styles.settingValue} numberOfLines={1}>{detail?.name}</Text>
              <Ionicons name="chevron-forward" size={19} color={COLORS.textMuted} />
            </Pressable>
          </Surface>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>群成员（{members.length}）</Text>
          {canManage ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAddMembers(true)}
              style={({ pressed }) => [styles.addMembers, pressed && styles.rowPressed]}
            >
              <Ionicons name="person-add-outline" size={20} color={COLORS.primary} />
              <Text style={styles.addMembersText}>添加成员</Text>
            </Pressable>
          ) : null}
        </View>

        <Surface>
          {members.map((member, index) => {
            const displayName = displayNameOf(member);
            const busy = pendingMemberId === member.userId;
            return (
              <View
                key={member.userId}
                style={[styles.memberRow, index > 0 && styles.rowDivider]}
              >
                <InitialAvatar name={displayName} userId={member.userId} size={46} />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName} numberOfLines={1}>{displayName}</Text>
                  <Text style={styles.memberMeta}>
                    {roleLabel(member.role)}{member.muted ? ' · 已禁言' : ''}
                  </Text>
                </View>
                {busy ? (
                  <View style={styles.memberControl}><ActivityIndicator size="small" color={COLORS.primary} /></View>
                ) : canManageMember(member) ? (
                  <IconButton
                    name="ellipsis-horizontal"
                    accessibilityLabel={`管理${displayName}`}
                    backgroundColor={COLORS.surfaceMuted}
                    onPress={() => setSelectedMember(member)}
                  />
                ) : null}
              </View>
            );
          })}
        </Surface>

        {detail ? (
          <Surface style={styles.dangerSurface}>
            <Pressable
              accessibilityRole="button"
              disabled={pendingGroupAction != null}
              onPress={() => leaveOrDissolve(isOwner)}
              style={({ pressed }) => [styles.dangerRow, pressed && styles.rowPressed, pendingGroupAction != null && styles.disabled]}
            >
              <View style={styles.dangerIcon}>
                <Ionicons name={isOwner ? 'trash-outline' : 'exit-outline'} size={23} color={COLORS.danger} />
              </View>
              <View style={styles.dangerTextWrap}>
                <Text style={styles.dangerTitle}>{isOwner ? '解散群聊' : '退出群聊'}</Text>
                <Text style={styles.dangerSubtitle}>
                  {isOwner ? '解散后，所有成员将无法继续使用此群聊' : '退出后将从你的会话列表中移除'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={COLORS.textMuted} />
            </Pressable>
          </Surface>
        ) : (
          <AppButton label="重试加载群资料" onPress={() => void load()} disabled={refreshing} />
        )}
      </ScrollView>

      <Modal visible={showRename} transparent animationType="slide" onRequestClose={() => setShowRename(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowRename(false)} />
          <View style={styles.compactSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>修改群名称</Text>
              <IconButton name="close" accessibilityLabel="关闭" onPress={() => setShowRename(false)} />
            </View>
            <AppTextField
              label="群名称"
              maxLength={100}
              autoFocus
              editable={pendingGroupAction == null}
              value={nameDraft}
              onChangeText={setNameDraft}
              onSubmitEditing={() => void rename()}
            />
            <View style={styles.sheetButtons}>
              <AppButton label="取消" variant="secondary" style={styles.flexButton} onPress={() => setShowRename(false)} />
              <AppButton
                label="保存"
                style={styles.flexButton}
                loading={pendingGroupAction === 'rename'}
                disabled={nameDraft.trim() === '' || nameDraft.trim() === detail?.name}
                onPress={() => void rename()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showAddMembers} transparent animationType="slide" onRequestClose={() => setShowAddMembers(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAddMembers(false)} />
          <View style={styles.memberSheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>添加群成员</Text>
                <Text style={styles.sheetSubtitle}>已选择 {addMemberIds.length} 人</Text>
              </View>
              <IconButton name="close" accessibilityLabel="关闭" onPress={() => setShowAddMembers(false)} />
            </View>
            <View style={styles.selector}>
              {directory ? (
                <DepartmentContactPicker
                  model={directory}
                  mode="multiple"
                  selectedIds={selectedIds}
                  disabledIds={existingMemberIds}
                  excludedIds={new Set(myId == null ? [] : [myId])}
                  disabled={pendingGroupAction != null}
                  onSelectionChange={setSelectedIds}
                />
              ) : (
                <StatusNotice message="通讯录不可用，请在下方手工输入成员 userId。" tone="warning" />
              )}
            </View>
            <AppTextField
              label="手工补充（可选）"
              placeholder="成员 userId，如 2, 3"
              editable={pendingGroupAction == null}
              value={manualMemberIds}
              onChangeText={setManualMemberIds}
            />
            <View style={styles.sheetButtons}>
              <AppButton label="取消" variant="secondary" style={styles.flexButton} onPress={() => setShowAddMembers(false)} />
              <AppButton
                label={`添加（${addMemberIds.length}）`}
                style={styles.flexButton}
                loading={pendingGroupAction === 'add'}
                disabled={addMemberIds.length === 0}
                onPress={() => void addMembers()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={selectedMember != null} transparent animationType="slide" onRequestClose={() => setSelectedMember(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedMember(null)} />
          {selectedMember ? (
            <View style={styles.actionSheet}>
              <View style={styles.actionMemberHeader}>
                <InitialAvatar name={displayNameOf(selectedMember)} userId={selectedMember.userId} size={48} />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{displayNameOf(selectedMember)}</Text>
                  <Text style={styles.memberMeta}>{roleLabel(selectedMember.role)}</Text>
                </View>
                <IconButton name="close" accessibilityLabel="关闭" onPress={() => setSelectedMember(null)} />
              </View>
              {isOwner && selectedMember.role === 'MEMBER' ? (
                <ActionRow
                  icon="shield-checkmark-outline"
                  label="设为管理员"
                  onPress={() => void runMemberAction(selectedMember.userId, () => sdk.groups.setMemberRole(groupId, selectedMember.userId, 'ADMIN'))}
                />
              ) : null}
              {isOwner && selectedMember.role === 'ADMIN' ? (
                <ActionRow
                  icon="shield-outline"
                  label="取消管理员"
                  onPress={() => void runMemberAction(selectedMember.userId, () => sdk.groups.setMemberRole(groupId, selectedMember.userId, 'MEMBER'))}
                />
              ) : null}
              {selectedMember.role === 'MEMBER' && canManage ? (
                <ActionRow
                  icon={selectedMember.muted ? 'volume-high-outline' : 'volume-mute-outline'}
                  label={selectedMember.muted ? '解除禁言' : '禁言'}
                  onPress={() => void runMemberAction(selectedMember.userId, () => sdk.groups.setMemberMuted(groupId, selectedMember.userId, !selectedMember.muted))}
                />
              ) : null}
              {isOwner ? (
                <ActionRow icon="swap-horizontal-outline" label="转让群主" onPress={() => transferOwner(selectedMember)} />
              ) : null}
              <ActionRow icon="person-remove-outline" label="移出群聊" danger onPress={() => removeMember(selectedMember)} />
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.page },
  content: { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl },
  centerLoader: { marginTop: 64 },
  hero: { alignItems: 'center', paddingVertical: SPACING.lg, gap: SPACING.xs },
  groupName: { color: COLORS.text, fontSize: TYPE.title, fontWeight: '800', marginTop: SPACING.xs },
  groupMeta: { color: COLORS.textSecondary, fontSize: TYPE.body, textAlign: 'center' },
  settingRow: { minHeight: 62, paddingHorizontal: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  settingLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  settingLabel: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '700' },
  settingValue: { flex: 1, color: COLORS.textSecondary, fontSize: TYPE.body, textAlign: 'right' },
  sectionHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.xs },
  sectionTitle: { color: COLORS.textSecondary, fontSize: TYPE.body, fontWeight: '600' },
  addMembers: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingHorizontal: SPACING.xs },
  addMembersText: { color: COLORS.primary, fontSize: TYPE.body, fontWeight: '700' },
  memberRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { color: COLORS.text, fontSize: TYPE.subtitle, fontWeight: '700' },
  memberMeta: { color: COLORS.textSecondary, fontSize: TYPE.caption, marginTop: 3 },
  memberControl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dangerSurface: { marginTop: SPACING.md },
  dangerRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  dangerIcon: { width: 42, height: 42, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.dangerSoft },
  dangerTextWrap: { flex: 1 },
  dangerTitle: { color: COLORS.danger, fontSize: TYPE.body, fontWeight: '700' },
  dangerSubtitle: { color: COLORS.textSecondary, fontSize: TYPE.caption, marginTop: 3, lineHeight: 17 },
  disabled: { opacity: 0.45 },
  rowPressed: { opacity: 0.62 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.overlay },
  compactSheet: { padding: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.md, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: COLORS.surface },
  memberSheet: { height: '78%', padding: SPACING.md, paddingBottom: SPACING.xl, gap: SPACING.sm, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: COLORS.surface },
  actionSheet: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.xxl, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: COLORS.surface },
  sheetHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: COLORS.text, fontSize: TYPE.subtitle, fontWeight: '800' },
  sheetSubtitle: { color: COLORS.textSecondary, fontSize: TYPE.caption, marginTop: 3 },
  sheetButtons: { flexDirection: 'row', gap: SPACING.sm },
  flexButton: { flex: 1 },
  selector: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border, borderRadius: RADIUS.lg, overflow: 'hidden' },
  actionMemberHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  actionRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  actionIcon: { width: 38, height: 38, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceMuted },
  actionIconDanger: { backgroundColor: COLORS.dangerSoft },
  actionLabel: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '600' },
  actionLabelDanger: { color: COLORS.danger },
});
