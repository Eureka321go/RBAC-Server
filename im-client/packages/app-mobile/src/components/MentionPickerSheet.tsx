import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import type { GroupMember, GroupRole } from '@im/sdk-core';
import { InitialAvatar } from './Avatar';
import { AppButton } from './AppButton';
import { IconButton } from './IconButton';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

export type MentionPickerSelection =
  | { kind: 'members'; members: GroupMember[] }
  | { kind: 'all' };

interface Props {
  visible: boolean;
  members: readonly GroupMember[];
  myId: number | null;
  myRole: GroupRole | null;
  excludedUserIds: ReadonlySet<number>;
  onClose: () => void;
  onConfirm: (selection: MentionPickerSelection) => void;
}

export function MentionPickerSheet({
  visible,
  members,
  myId,
  myRole,
  excludedUserIds,
  onClose,
  onConfirm,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(() => new Set());
  const [selectedAll, setSelectedAll] = useState(false);

  useEffect(() => {
    setQuery('');
    setSelectedUserIds(new Set());
    setSelectedAll(false);
  }, [visible]);

  const canMentionAll = myRole === 'OWNER' || myRole === 'ADMIN';
  const availableMembers = useMemo(
    () => members.filter(
      (member) => member.userId !== myId && !excludedUserIds.has(member.userId),
    ),
    [excludedUserIds, members, myId],
  );
  const filteredMembers = useMemo(() => {
    const keyword = query.trim();
    if (keyword === '') return availableMembers;
    return availableMembers.filter((member) =>
      (member.displayName?.trim() || `用户 #${member.userId}`).includes(keyword),
    );
  }, [availableMembers, query]);

  const close = () => {
    setQuery('');
    setSelectedUserIds(new Set());
    setSelectedAll(false);
    onClose();
  };

  const toggleMember = (userId: number) => {
    setSelectedAll(false);
    setSelectedUserIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const confirm = () => {
    if (selectedAll) {
      onConfirm({ kind: 'all' });
      return;
    }
    const byId = new Map(availableMembers.map((member) => [member.userId, member]));
    const selectedMembers = [...selectedUserIds].flatMap((userId) => {
      const member = byId.get(userId);
      return member == null ? [] : [member];
    });
    if (selectedMembers.length > 0) onConfirm({ kind: 'members', members: selectedMembers });
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭提及成员选择"
          style={StyleSheet.absoluteFill}
          onPress={close}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>提及成员</Text>
            <IconButton name="close" accessibilityLabel="关闭" onPress={close} />
          </View>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={19} color={COLORS.textMuted} />
            <TextInput
              autoCorrect={false}
              placeholder="搜索群成员"
              placeholderTextColor={COLORS.textMuted}
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <FlatList
            data={filteredMembers}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(member) => String(member.userId)}
            style={styles.list}
            ListHeaderComponent={canMentionAll ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selectedAll }}
                style={[styles.memberRow, selectedAll && styles.selectedRow]}
                onPress={() => {
                  setSelectedAll((current) => !current);
                  setSelectedUserIds(new Set());
                }}
              >
                <View style={[styles.checkbox, selectedAll && styles.checkboxSelected]}>
                  {selectedAll ? <Ionicons name="checkmark" size={17} color={COLORS.white} /> : null}
                </View>
                <View style={styles.allAvatar}>
                  <Ionicons name="people" size={21} color={COLORS.primary} />
                </View>
                <View style={styles.grow}>
                  <Text style={styles.memberName}>所有人</Text>
                  <Text style={styles.meta}>提醒全部群成员</Text>
                </View>
              </Pressable>
            ) : null}
            ListEmptyComponent={<Text style={styles.empty}>没有匹配的群成员</Text>}
            renderItem={({ item }) => {
              const selected = selectedUserIds.has(item.userId);
              const name = item.displayName?.trim() || `用户 #${item.userId}`;
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[styles.memberRow, selected && styles.selectedRow]}
                  onPress={() => toggleMember(item.userId)}
                >
                  <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                    {selected ? <Ionicons name="checkmark" size={17} color={COLORS.white} /> : null}
                  </View>
                  <InitialAvatar name={name} userId={item.userId} size={38} />
                  <View style={styles.grow}>
                    <Text style={styles.memberName}>{name}</Text>
                    <Text style={styles.meta}>#{item.userId}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
          <AppButton
            label={selectedAll ? '确定（所有人）' : `确定（${selectedUserIds.size}）`}
            disabled={!selectedAll && selectedUserIds.size === 0}
            onPress={confirm}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.overlay },
  sheet: {
    height: '76%',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: COLORS.surface,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  title: { color: COLORS.text, fontSize: TYPE.subtitle, fontWeight: '800' },
  searchWrap: {
    minHeight: 46,
    marginVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: TYPE.body, paddingVertical: SPACING.xs },
  list: { flex: 1, marginBottom: SPACING.sm },
  memberRow: {
    minHeight: 64,
    paddingHorizontal: SPACING.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  selectedRow: { backgroundColor: COLORS.primarySoft },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  checkboxSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  allAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  grow: { flex: 1 },
  memberName: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '600' },
  meta: { marginTop: 2, color: COLORS.textSecondary, fontSize: TYPE.caption },
  empty: { color: COLORS.textSecondary, textAlign: 'center', paddingVertical: SPACING.xl },
});
