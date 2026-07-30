import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import type { RootStackParamList } from '../navigation/types';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { DepartmentContactPicker } from '../components/DepartmentContactPicker';
import {
  buildContactDirectory,
  type ContactDirectoryModel,
} from '../contact/directory';
import { AppButton } from '../components/AppButton';
import { AppTextField } from '../components/AppTextField';
import { StatusNotice } from '../components/StatusNotice';
import { Surface } from '../components/Surface';
import { AnimatedEntrance } from '../components/AnimatedEntrance';
import { SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateGroup'>;

export function CreateGroupScreen({ navigation }: Props) {
  const { theme } = useAppTheme();
  const myId = useAppStore(state => state.myId);
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState<ContactDirectoryModel | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [hint, setHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void sdk.contacts
      .getDirectory()
      .then(result => {
        if (mountedRef.current) setDirectory(buildContactDirectory(result));
      })
      .catch(() => {
        if (mountedRef.current) {
          setHint('联系人列表不可用，请稍后重试。');
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
    const ids = new Set(selectedIds);
    if (myId != null) ids.delete(myId);
    return [...ids];
  }, [myId, selectedIds]);

  const canCreate = name.trim() !== '' && memberIds.length > 0 && !submitting;

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
      setHint(
        `创建群聊失败：${cause instanceof Error ? cause.message : 'unknown'}`,
      );
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.page, { backgroundColor: theme.colors.page }]}>
      <CompactScreenHeader
        title="创建群聊"
        onBack={() => navigation.goBack()}
      />
      <AnimatedEntrance style={styles.content}>
        <Surface style={styles.nameCard}>
          <View style={styles.nameHeading}>
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
              群聊信息
            </Text>
            <Text style={[styles.required, { color: theme.colors.primary }]}>
              必填
            </Text>
          </View>
          <AppTextField
            label="群名称"
            placeholder="请输入群名称"
            maxLength={100}
            returnKeyType="done"
            editable={!submitting}
            value={name}
            onChangeText={setName}
          />
          <Text style={[styles.helper, { color: theme.colors.textMuted }]}>
            创建后仍可在群设置中修改
          </Text>
        </Surface>
        {hint ? (
          <StatusNotice
            message={hint}
            tone={hint.includes('失败') ? 'error' : 'warning'}
          />
        ) : null}
        <View style={styles.sectionHeader}>
          <View>
            <Text style={[styles.section, { color: theme.colors.text }]}>
              选择成员
            </Text>
            <Text
              style={[
                styles.sectionHint,
                { color: theme.colors.textSecondary },
              ]}
            >
              至少选择一位联系人
            </Text>
          </View>
          <View
            style={[
              styles.countBadge,
              {
                backgroundColor:
                  memberIds.length > 0
                    ? theme.colors.primarySoft
                    : theme.colors.surfaceMuted,
              },
            ]}
          >
            <Text
              style={[
                styles.count,
                {
                  color:
                    memberIds.length > 0
                      ? theme.colors.primary
                      : theme.colors.textSecondary,
                },
                memberIds.length > 0 && styles.countActive,
              ]}
            >
              已选 {memberIds.length} 人
            </Text>
          </View>
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
          <Surface style={styles.emptyCard}>
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
              通讯录暂不可用
            </Text>
            <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>
              暂时无法选择成员，请稍后重试
            </Text>
          </Surface>
        )}
        <View style={styles.footer}>
          <AppButton
            label={submitting ? '正在创建…' : '创建并进入群聊'}
            icon="people-outline"
            loading={submitting}
            disabled={!canCreate}
            onPress={() => void create()}
          />
        </View>
      </AnimatedEntrance>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flex: 1, padding: SPACING.md, gap: SPACING.md },
  nameCard: { padding: SPACING.md, gap: SPACING.sm },
  nameHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: { fontSize: TYPE.subtitle, fontWeight: '700' },
  required: { fontSize: TYPE.caption, fontWeight: '600' },
  helper: { fontSize: TYPE.caption },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  section: { fontSize: TYPE.subtitle, fontWeight: '700' },
  sectionHint: { marginTop: 3, fontSize: TYPE.caption },
  countBadge: {
    minHeight: 30,
    paddingHorizontal: SPACING.sm,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontSize: TYPE.caption },
  countActive: { fontWeight: '700' },
  directory: { flex: 1 },
  emptyCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  emptyTitle: { fontSize: TYPE.body, fontWeight: '700' },
  empty: { marginTop: SPACING.xs, textAlign: 'center' },
  footer: { paddingTop: SPACING.xxs, paddingBottom: SPACING.xs },
});
