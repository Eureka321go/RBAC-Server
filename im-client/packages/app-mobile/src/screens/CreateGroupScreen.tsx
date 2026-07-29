import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
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
import { DepartmentContactPicker } from '../components/DepartmentContactPicker';
import { buildContactDirectory, type ContactDirectoryModel } from '../contact/directory';

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
  const [directory, setDirectory] = useState<ContactDirectoryModel | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [manualIds, setManualIds] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void sdk.contacts.getDirectory()
      .then((result) => {
        if (mountedRef.current) setDirectory(buildContactDirectory(result));
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

  const excludedIds = useMemo(
    () => new Set(myId == null ? [] : [myId]),
    [myId],
  );

  const memberIds = useMemo(() => {
    const ids = new Set([...selectedIds, ...parseManualIds(manualIds)]);
    if (myId != null) ids.delete(myId);
    return [...ids];
  }, [manualIds, myId, selectedIds]);

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
        {directory ? (
          <DepartmentContactPicker
            model={directory}
            mode="multiple"
            selectedIds={selectedIds}
            excludedIds={excludedIds}
            disabled={submitting}
            onSelectionChange={setSelectedIds}
          />
        ) : (
          <Text style={styles.empty}>通讯录不可用，可在下方手工输入成员 userId。</Text>
        )}
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
  empty: { flex: 1, color: '#64748b', textAlign: 'center', paddingTop: 24 },
});
