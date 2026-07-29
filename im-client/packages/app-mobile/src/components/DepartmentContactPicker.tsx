import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ContactMember } from '@im/sdk-core';
import type { ContactDirectoryModel } from '../contact/directory';

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
        <Pressable onPress={() => setLocation(null)}>
          <Text style={[styles.crumb, location == null && styles.crumbCurrent]}>通讯录</Text>
        </Pressable>
        {breadcrumbs.map((crumb) => (
          <React.Fragment key={String(crumb.id)}>
            <Text style={styles.separator}>/</Text>
            <Pressable onPress={() => setLocation(crumb.id)}>
              <Text style={styles.crumb}>{crumb.name}</Text>
            </Pressable>
          </React.Fragment>
        ))}
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
                  <Text style={styles.folder}>▸</Text>
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
                  <Text style={styles.folder}>▸</Text>
                  <View style={styles.grow}>
                    <Text style={styles.departmentName}>{department.name}</Text>
                    <Text style={styles.meta}>{availableIds.length} 人</Text>
                  </View>
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
                  <Text style={styles.checkmark}>{selected ? '✓' : ''}</Text>
                </View>
              ) : null}
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
  wrap: { flex: 1, minHeight: 180 },
  breadcrumbs: { minHeight: 38, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  crumb: { color: '#2563eb', fontSize: 13, paddingVertical: 5 },
  crumbCurrent: { color: '#334155', fontWeight: '700' },
  separator: { color: '#94a3b8' },
  departmentRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
  departmentOpen: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  folder: { color: '#64748b', fontSize: 18, width: 28 },
  grow: { flex: 1 },
  departmentName: { color: '#0f172a', fontSize: 15, fontWeight: '700' },
  selectAll: { color: '#2563eb', fontSize: 13, fontWeight: '600', padding: 10 },
  memberRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 28, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
  selectedRow: { backgroundColor: '#eff6ff' },
  unavailable: { opacity: 0.45 },
  checkbox: { width: 24, height: 24, borderWidth: 1, borderColor: '#94a3b8', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { borderColor: '#2563eb', backgroundColor: '#2563eb' },
  checkmark: { color: '#ffffff', fontWeight: '700' },
  memberName: { color: '#0f172a', fontSize: 15, fontWeight: '600' },
  meta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 24 },
});
