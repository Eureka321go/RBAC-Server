import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ContactMember } from '@im/sdk-core';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import type { ContactDirectoryModel } from '../contact/directory';
import { InitialAvatar } from './Avatar';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

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
    <View style={styles.wrap}>
      <View style={styles.breadcrumbs}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回通讯录根目录"
          disabled={location == null}
          hitSlop={8}
          onPress={() => setLocation(null)}
        >
          <Text style={[styles.crumb, location == null && styles.crumbCurrent]}>通讯录</Text>
        </Pressable>
        {breadcrumbs.map((crumb, index) => {
          const current = index === breadcrumbs.length - 1;
          return (
            <React.Fragment key={String(crumb.id)}>
              <Ionicons
                name="chevron-forward"
                size={15}
                color={COLORS.textMuted}
                style={styles.separator}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={current ? `当前目录：${crumb.name}` : `返回${crumb.name}`}
                disabled={current}
                hitSlop={8}
                onPress={() => setLocation(crumb.id)}
              >
                <Text style={[styles.crumb, current && styles.crumbCurrent]}>{crumb.name}</Text>
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
        ListEmptyComponent={<Text style={styles.empty}>当前部门暂无成员或子部门</Text>}
        renderItem={({ item }) => {
          if (item.kind === 'unassigned') {
            const availableIds = model.unassignedMemberIds.filter((id) => !isUnavailable(id));
            const allSelected = availableIds.length > 0
              && availableIds.every((userId) => selectedIds.has(userId));
            return (
              <View style={styles.departmentRow}>
                <Pressable style={styles.departmentOpen} onPress={() => setLocation('unassigned')}>
                  <View style={styles.departmentIcon}>
                    <Ionicons name="folder-outline" size={20} color={COLORS.primary} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.departmentName}>未分配部门</Text>
                    <Text style={styles.meta}>{availableIds.length} 人</Text>
                  </View>
                </Pressable>
                {mode === 'multiple' && availableIds.length > 0 ? (
                  <Pressable disabled={disabled} onPress={toggleUnassigned}>
                    <Text style={styles.selectAll}>{allSelected ? '取消全选' : '全选'}</Text>
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
              <View style={styles.departmentRow}>
                <Pressable style={styles.departmentOpen} onPress={() => setLocation(department.id)}>
                  <View style={styles.departmentIcon}>
                    <Ionicons name="folder-outline" size={20} color={COLORS.primary} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.departmentName}>{department.name}</Text>
                    <Text style={styles.meta}>{availableIds.length} 人</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </Pressable>
                {mode === 'multiple' && availableIds.length > 0 ? (
                  <Pressable disabled={disabled} onPress={() => toggleDepartment(department.id)}>
                    <Text style={styles.selectAll}>{allSelected ? '取消全选' : '全选'}</Text>
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
              disabled={unavailable}
              style={[styles.memberRow, selected && styles.selectedRow, unavailable && styles.unavailable]}
              onPress={() => toggleMember(member)}
            >
              {mode === 'multiple' ? (
                <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                  {selected ? <Ionicons name="checkmark" size={17} color={COLORS.white} /> : null}
                </View>
              ) : null}
              <InitialAvatar name={member.displayName} userId={member.userId} size={38} />
              <View style={styles.grow}>
                <Text style={styles.memberName}>{member.displayName}</Text>
                <Text style={styles.meta}>#{member.userId}{unavailable ? ' · 不可选择' : ''}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 180, backgroundColor: COLORS.surface },
  breadcrumbs: { minHeight: 52, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  crumb: { color: COLORS.primary, fontSize: TYPE.body, lineHeight: 22, fontWeight: '500', paddingVertical: 5 },
  crumbCurrent: { color: COLORS.text, fontWeight: '700' },
  separator: { marginHorizontal: SPACING.xs },
  departmentRow: { minHeight: 64, paddingHorizontal: SPACING.sm, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  departmentOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  departmentIcon: { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primarySoft },
  grow: { flex: 1 },
  departmentName: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '700' },
  selectAll: { color: COLORS.primary, fontSize: 13, fontWeight: '600', padding: SPACING.sm },
  memberRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  selectedRow: { backgroundColor: COLORS.primarySoft },
  unavailable: { opacity: 0.45 },
  checkbox: { width: 24, height: 24, borderWidth: 1, borderColor: COLORS.borderStrong, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  checkboxSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  memberName: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '600' },
  meta: { color: COLORS.textSecondary, fontSize: TYPE.caption, marginTop: 2 },
  empty: { color: COLORS.textSecondary, textAlign: 'center', paddingVertical: SPACING.xl },
});
