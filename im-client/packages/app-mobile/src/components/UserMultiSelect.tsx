import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { userDisplayName, type SelectableUser } from '../services/users';

interface Props {
  users: SelectableUser[];
  selectedIds: ReadonlySet<number>;
  disabledIds?: ReadonlySet<number>;
  disabled?: boolean;
  onToggle: (userId: number) => void;
}

export function UserMultiSelect({
  users,
  selectedIds,
  disabledIds = new Set<number>(),
  disabled = false,
  onToggle,
}: Props) {
  return (
    <FlatList
      data={users}
      keyExtractor={(user) => String(user.id)}
      ListEmptyComponent={<Text style={styles.empty}>没有可选联系人</Text>}
      renderItem={({ item }) => {
        const selected = selectedIds.has(item.id);
        const itemDisabled = disabled || disabledIds.has(item.id);
        return (
          <Pressable
            disabled={itemDisabled}
            style={[styles.row, selected && styles.selected, itemDisabled && styles.disabled]}
            onPress={() => onToggle(item.id)}
          >
            <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
              <Text style={styles.checkmark}>{selected ? '✓' : ''}</Text>
            </View>
            <View style={styles.label}>
              <Text style={styles.name}>{userDisplayName(item)}</Text>
              <Text style={styles.id}>#{item.id}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  selected: { backgroundColor: '#eff6ff' },
  disabled: { opacity: 0.45 },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: '#94a3b8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { borderColor: '#2563eb', backgroundColor: '#2563eb' },
  checkmark: { color: '#ffffff', fontWeight: '700' },
  label: { flex: 1 },
  name: { color: '#0f172a', fontSize: 15, fontWeight: '600' },
  id: { color: '#64748b', fontSize: 12, marginTop: 2 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 24 },
});
