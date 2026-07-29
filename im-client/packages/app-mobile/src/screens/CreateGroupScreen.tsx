import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import type { RootStackParamList } from '../navigation/types';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { DepartmentContactPicker } from '../components/DepartmentContactPicker';
import { buildContactDirectory, type ContactDirectoryModel } from '../contact/directory';
import { AppButton } from '../components/AppButton';
import { AppTextField } from '../components/AppTextField';
import { StatusNotice } from '../components/StatusNotice';
import { Surface } from '../components/Surface';
import { COLORS, SPACING, TYPE } from '../ui/theme';

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
        <AppTextField
          label="群名称"
          placeholder="群名称"
          maxLength={100}
          editable={!submitting}
          value={name}
          onChangeText={setName}
        />
        {hint ? <StatusNotice message={hint} tone={hint.includes('失败') ? 'error' : 'warning'} /> : null}
        <View style={styles.sectionHeader}>
          <Text style={styles.section}>选择成员</Text>
          <Text style={styles.count}>已选 {memberIds.length} 人</Text>
        </View>
        {directory ? (
          <Surface style={styles.directory}>
            <DepartmentContactPicker
              model={directory}
              mode="multiple"
              selectedIds={selectedIds}
              excludedIds={excludedIds}
              disabled={submitting}
              onSelectionChange={setSelectedIds}
            />
          </Surface>
        ) : (
          <Text style={styles.empty}>通讯录不可用，可在下方手工输入成员 userId。</Text>
        )}
        <AppTextField
          label="手工补充（可选）"
          placeholder="补充成员 userId，如 2, 3"
          editable={!submitting}
          value={manualIds}
          onChangeText={setManualIds}
        />
        <AppButton
          label={submitting ? '正在创建…' : '创建并进入群聊'}
          loading={submitting}
          disabled={submitting}
          onPress={() => void create()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.page },
  content: { flex: 1, padding: SPACING.md, gap: SPACING.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '700' },
  count: { color: COLORS.textSecondary, fontSize: TYPE.caption },
  directory: { flex: 1 },
  empty: { flex: 1, color: COLORS.textSecondary, textAlign: 'center', paddingTop: SPACING.xl },
});
