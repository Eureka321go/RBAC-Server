import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ContactMember } from '@im/sdk-core';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import type { ContactDirectoryModel } from '../contact/directory';
import { InitialAvatar } from './Avatar';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

type Location = number | 'unassigned' | null;

interface Props {
  model: ContactDirectoryModel;
  mode: 'single' | 'multiple';
  selectedIds?: ReadonlySet<number>;
  disabledIds?: ReadonlySet<number>;
  excludedIds?: ReadonlySet<number>;
  disabled?: boolean;
  onSelectionChange?: (selectedIds: Set<number>) => void;
  onMemberPress?: (member: ContactMember) => void;
}

type PickerRow =
  | { kind: 'department'; departmentId: number }
  | { kind: 'unassigned' }
  | { kind: 'member'; memberId: number };

export function DepartmentContactPicker({
  model,
  mode,
  selectedIds = new Set<number>(),
  disabledIds = new Set<number>(),
  excludedIds = new Set<number>(),
  disabled = false,
  onSelectionChange,
  onMemberPress,
}: Props) {
  const { theme } = useAppTheme();
  const [location, setLocation] = useState<Location>(null);

  const isUnavailable = (userId: number) => disabledIds.has(userId) || excludedIds.has(userId);
  const selectableIds = (departmentId: number): number[] => (
    model.descendantMemberIds.get(departmentId) ?? []
  ).filter((userId) => !isUnavailable(userId));

  const breadcrumbs = useMemo(() => {
    if (location == null) return [];
    if (location === 'unassigned') return [{ id: 'unassigned' as const, name: '未分配部门' }];
    const result: Array<{ id: number; name: string }> = [];
    const seen = new Set<number>();
    let cursor: number | null = location;
    while (cursor != null && !seen.has(cursor)) {
      seen.add(cursor);
      const department = model.departmentsById.get(cursor);
      if (department == null) break;
      result.unshift({ id: department.id, name: department.name });
      cursor = model.parentDepartmentId.get(cursor) ?? null;
    }
    return result;
  }, [location, model]);

  const rows = useMemo<PickerRow[]>(() => {
    if (location === 'unassigned') {
      return model.unassignedMemberIds.map((memberId) => ({ kind: 'member', memberId }));
    }
    const departmentIds = location == null
      ? model.rootDepartmentIds
      : model.childDepartmentIds.get(location) ?? [];
    const memberIds = location == null ? [] : model.directMemberIds.get(location) ?? [];
    return [
      ...departmentIds.map((departmentId): PickerRow => ({ kind: 'department', departmentId })),
      ...(location == null && model.unassignedMemberIds.length > 0
        ? [{ kind: 'unassigned' } as PickerRow]
        : []),
      ...memberIds.map((memberId): PickerRow => ({ kind: 'member', memberId })),
    ];
  }, [location, model]);

  const toggleMember = (member: ContactMember) => {
    if (disabled || isUnavailable(member.userId)) return;
    if (mode === 'single') {
      onMemberPress?.(member);
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(member.userId)) next.delete(member.userId);
    else next.add(member.userId);
    onSelectionChange?.(next);
  };

  const toggleDepartment = (departmentId: number) => {
    if (disabled || mode !== 'multiple') return;
    const ids = selectableIds(departmentId);
    const allSelected = ids.length > 0 && ids.every((userId) => selectedIds.has(userId));
    const next = new Set(selectedIds);
    ids.forEach((userId) => {
      if (allSelected) next.delete(userId);
      else next.add(userId);
    });
    onSelectionChange?.(next);
  };

  const toggleUnassigned = () => {
    if (disabled || mode !== 'multiple') return;
    const ids = model.unassignedMemberIds.filter((userId) => !isUnavailable(userId));
    const allSelected = ids.length > 0 && ids.every((userId) => selectedIds.has(userId));
    const next = new Set(selectedIds);
    ids.forEach((userId) => {
      if (allSelected) next.delete(userId);
      else next.add(userId);
    });
    onSelectionChange?.(next);
  };

  return (
    <View style={[styles.wrap, { backgroundColor: theme.colors.surface }]}>
      <View style={[styles.breadcrumbs, { borderBottomColor: theme.colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回通讯录根目录"
          disabled={location == null}
          hitSlop={8}
          onPress={() => setLocation(null)}
        >
          <Text style={[
            styles.crumb,
            { color: location == null ? theme.colors.text : theme.colors.primary },
            location == null && styles.crumbCurrent,
          ]}>通讯录</Text>
        </Pressable>
        {breadcrumbs.map((crumb, index) => {
          const current = index === breadcrumbs.length - 1;
          return (
            <React.Fragment key={String(crumb.id)}>
              <Ionicons
                name="chevron-forward"
                size={15}
                color={theme.colors.textMuted}
                style={styles.separator}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={current ? `当前目录：${crumb.name}` : `返回${crumb.name}`}
                disabled={current}
                hitSlop={8}
                onPress={() => setLocation(crumb.id)}
              >
                <Text style={[
                  styles.crumb,
                  { color: current ? theme.colors.text : theme.colors.primary },
                  current && styles.crumbCurrent,
                ]}>{crumb.name}</Text>
              </Pressable>
            </React.Fragment>
          );
        })}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.kind === 'department'
          ? `d:${row.departmentId}`
          : row.kind === 'member' ? `m:${row.memberId}` : 'unassigned'}
        ListEmptyComponent={(
          <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>当前部门暂无成员或子部门</Text>
        )}
        renderItem={({ item }) => {
          if (item.kind === 'unassigned') {
            const availableIds = model.unassignedMemberIds.filter((id) => !isUnavailable(id));
            const allSelected = availableIds.length > 0
              && availableIds.every((userId) => selectedIds.has(userId));
            return (
              <View style={[styles.departmentRow, { borderBottomColor: theme.colors.border }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="打开未分配部门"
                  style={styles.departmentOpen}
                  onPress={() => setLocation('unassigned')}
                >
                  <View style={[styles.departmentIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name="folder-outline" size={20} color={theme.colors.primary} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.departmentName, { color: theme.colors.text }]}>未分配部门</Text>
                    <Text style={[styles.meta, { color: theme.colors.textSecondary }]}>{availableIds.length} 人</Text>
                  </View>
                </Pressable>
                {mode === 'multiple' && availableIds.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${allSelected ? '取消全选' : '全选'}未分配部门成员`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    style={styles.selectAllButton}
                    onPress={toggleUnassigned}
                  >
                    <Text style={[styles.selectAll, { color: theme.colors.primary }]}>{allSelected ? '取消全选' : '全选'}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }
          if (item.kind === 'department') {
            const department = model.departmentsById.get(item.departmentId);
            if (department == null) return null;
            const availableIds = selectableIds(department.id);
            const allSelected = availableIds.length > 0
              && availableIds.every((userId) => selectedIds.has(userId));
            return (
              <View style={[styles.departmentRow, { borderBottomColor: theme.colors.border }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`打开${department.name}`}
                  style={styles.departmentOpen}
                  onPress={() => setLocation(department.id)}
                >
                  <View style={[styles.departmentIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name="folder-outline" size={20} color={theme.colors.primary} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.departmentName, { color: theme.colors.text }]}>{department.name}</Text>
                    <Text style={[styles.meta, { color: theme.colors.textSecondary }]}>{availableIds.length} 人</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                </Pressable>
                {mode === 'multiple' && availableIds.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${allSelected ? '取消全选' : '全选'}${department.name}成员`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    style={styles.selectAllButton}
                    onPress={() => toggleDepartment(department.id)}
                  >
                    <Text style={[styles.selectAll, { color: theme.colors.primary }]}>{allSelected ? '取消全选' : '全选'}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }

          const member = model.membersById.get(item.memberId);
          if (member == null) return null;
          const unavailable = disabled || isUnavailable(member.userId);
          const selected = selectedIds.has(member.userId);
          return (
            <Pressable
              accessibilityRole={mode === 'multiple' ? 'checkbox' : 'button'}
              accessibilityLabel={`${mode === 'multiple' ? '选择' : '打开会话：'}${member.displayName}`}
              accessibilityState={{ checked: mode === 'multiple' ? selected : undefined, disabled: unavailable }}
              disabled={unavailable}
              style={[
                styles.memberRow,
                { borderBottomColor: theme.colors.border },
                selected && { backgroundColor: theme.colors.primarySoft },
                unavailable && styles.unavailable,
              ]}
              onPress={() => toggleMember(member)}
            >
              {mode === 'multiple' ? (
                <View style={[
                  styles.checkbox,
                  {
                    borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
                    backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                  },
                ]}>
                  {selected ? <Ionicons name="checkmark" size={17} color={theme.colors.white} /> : null}
                </View>
              ) : null}
              <InitialAvatar name={member.displayName} userId={member.userId} size={38} />
              <View style={styles.grow}>
                <Text style={[styles.memberName, { color: theme.colors.text }]}>{member.displayName}</Text>
                <Text style={[styles.meta, { color: theme.colors.textSecondary }]}>#{member.userId}{unavailable ? ' · 不可选择' : ''}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 180 },
  breadcrumbs: { minHeight: 52, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', borderBottomWidth: StyleSheet.hairlineWidth },
  crumb: { fontSize: TYPE.body, lineHeight: 22, fontWeight: '500', paddingVertical: 5 },
  crumbCurrent: { fontWeight: '700' },
  separator: { marginHorizontal: SPACING.xs },
  departmentRow: { minHeight: 64, paddingHorizontal: SPACING.sm, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  departmentOpen: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  departmentIcon: { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  departmentName: { fontSize: TYPE.body, fontWeight: '700' },
  selectAll: { fontSize: 13, fontWeight: '600', padding: SPACING.sm },
  selectAllButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  memberRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  unavailable: { opacity: 0.45 },
  checkbox: { width: 24, height: 24, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  memberName: { fontSize: TYPE.body, fontWeight: '600' },
  meta: { fontSize: TYPE.caption, marginTop: 2 },
  empty: { textAlign: 'center', paddingVertical: SPACING.xl },
});
