import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import type { RootStackParamList } from '../navigation/types';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import {
  listSelectableUsers,
  userDisplayName,
  type SelectableUser,
} from '../services/users';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateGroup'>;

function parseManualIds(value: string): number[] {
  return value
    .split(/[\s,，]+/)
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export function CreateGroupScreen({ navigation }: Props) {
  const myId = useAppStore((state) => state.myId);
  const [name, setName] = useState('');
  const [users, setUsers] = useState<SelectableUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [manualIds, setManualIds] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void listSelectableUsers(myId)
      .then((items) => {
        if (mountedRef.current) setUsers(items);
      })
      .catch(() => {
        if (mountedRef.current) {
          setHint('联系人列表不可用，请在下方输入成员 userId，多个 ID 用逗号分隔。');
        }
      });
    return () => {
      mountedRef.current = false;
    };
  }, [myId]);

  const memberIds = useMemo(() => {
    const ids = new Set([...selectedIds, ...parseManualIds(manualIds)]);
    if (myId != null) ids.delete(myId);
    return [...ids];
  }, [manualIds, myId, selectedIds]);

  const toggle = (userId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const create = async () => {
    const groupName = name.trim();
    if (groupName === '') {
      setHint('请输入群名称。');
      return;
    }
    if (memberIds.length === 0) {
      setHint('请至少选择一位成员。');
      return;
    }
    setSubmitting(true);
    setHint('正在创建群聊…');
    try {
      const result = await sdk.groups.createGroup(groupName, memberIds);
      await sdk.sync.syncConversation(result.cid);
      await sdk.sync.setConversationDisplayName(result.cid, groupName);
      if (!mountedRef.current) return;
      navigation.replace('Chat', {
        cid: result.cid,
        title: groupName,
        conversationType: 'GROUP',
        groupId: result.groupId,
        syncOnOpen: false,
      });
    } catch (cause) {
      if (!mountedRef.current) return;
      setHint(`创建群聊失败：${cause instanceof Error ? cause.message : 'unknown'}`);
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.page}>
      <CompactScreenHeader title="创建群聊" onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <TextInput
          style={styles.input}
          placeholder="群名称"
          maxLength={100}
          editable={!submitting}
          value={name}
          onChangeText={setName}
        />
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        <Text style={styles.section}>选择成员（已选 {memberIds.length} 人）</Text>
        <FlatList
          style={styles.list}
          data={users}
          keyExtractor={(user) => String(user.id)}
          renderItem={({ item }) => {
            const selected = selectedIds.has(item.id);
            return (
              <Pressable
                disabled={submitting}
                style={[styles.userRow, selected && styles.selectedRow]}
                onPress={() => toggle(item.id)}
              >
                <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                  <Text style={styles.checkmark}>{selected ? '✓' : ''}</Text>
                </View>
                <View>
                  <Text style={styles.userName}>{userDisplayName(item)}</Text>
                  <Text style={styles.userId}>#{item.id}</Text>
                </View>
              </Pressable>
            );
          }}
        />
        <TextInput
          style={styles.input}
          placeholder="补充成员 userId，如 2, 3"
          editable={!submitting}
          value={manualIds}
          onChangeText={setManualIds}
        />
        <Button
          title={submitting ? '正在创建…' : '创建并进入群聊'}
          disabled={submitting}
          onPress={() => void create()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' },
  content: { flex: 1, padding: 16, gap: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hint: { color: '#b45309', fontSize: 13 },
  section: { color: '#334155', fontSize: 14, fontWeight: '600' },
  list: { flex: 1 },
  userRow: {
    minHeight: 58,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  selectedRow: { backgroundColor: '#eff6ff' },
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
  userName: { color: '#0f172a', fontSize: 15, fontWeight: '600' },
  userId: { color: '#64748b', fontSize: 12, marginTop: 2 },
});
