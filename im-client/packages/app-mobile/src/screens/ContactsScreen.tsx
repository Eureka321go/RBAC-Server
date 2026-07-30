import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import type { RootTabScreenProps } from '../navigation/types';
import { DepartmentContactPicker } from '../components/DepartmentContactPicker';
import { buildContactDirectory, type ContactDirectoryModel } from '../contact/directory';
import { AppButton } from '../components/AppButton';
import { AppTextField } from '../components/AppTextField';
import { StatusNotice } from '../components/StatusNotice';
import { Surface } from '../components/Surface';
import { COLORS, SPACING, TYPE } from '../ui/theme';

type Props = RootTabScreenProps<'ContactsTab'>;

export function ContactsScreen({ navigation }: Props) {
  const myId = useAppStore((s) => s.myId);
  const [directory, setDirectory] = useState<ContactDirectoryModel | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const [openingPeerId, setOpeningPeerId] = useState<number | null>(null);
  const mountedRef = useRef(true);

  const openChat = useCallback(
    async (peerId: number, peerName: string) => {
      if (myId == null || peerId === myId || !Number.isSafeInteger(peerId) || peerId <= 0) {
        setHint('请输入有效的对端 userId。');
        return;
      }
      setOpeningPeerId(peerId);
      setHint('正在创建会话…');
      try {
        const cid = await sdk.sync.createSingleConversation(peerId);
        if (!mountedRef.current) return;
        setOpeningPeerId(null);
        navigation.replace('Chat', {
          cid,
          title: peerName,
          conversationType: 'SINGLE',
          syncOnOpen: true,
        });
      } catch (cause) {
        if (!mountedRef.current) return;
        setHint(`创建会话失败：${cause instanceof Error ? cause.message : 'unknown'}`);
        setOpeningPeerId(null);
      }
    },
    [myId, navigation],
  );

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        const result = await sdk.contacts.getDirectory();
        if (!mountedRef.current) return;
        setDirectory(buildContactDirectory(result));
        if (result.members.filter((member) => member.userId !== myId).length === 0) {
          setHint('没有可选联系人，可在下方直接输入对端 userId。');
        }
      } catch {
        if (mountedRef.current) {
          setHint('拉取通讯录失败，请在下方直接输入对端 userId。');
        }
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, [myId]);

  return (
    <View style={styles.page}>
      <CompactScreenHeader title="新建会话" onBack={() => navigation.goBack()} />
      <View style={styles.wrap}>
        {hint ? <StatusNotice message={hint} tone={hint.includes('失败') ? 'error' : 'warning'} /> : null}
        {directory ? (
          <Surface style={styles.directory}>
            <DepartmentContactPicker
              model={directory}
              mode="single"
              excludedIds={new Set(myId == null ? [] : [myId])}
              disabled={openingPeerId != null}
              onMemberPress={(member) => void openChat(member.userId, member.displayName)}
            />
          </Surface>
        ) : null}
        <View style={styles.manual}>
          <Text style={styles.manualTitle}>找不到联系人？</Text>
          <AppTextField
            placeholder="直接输入对端 userId"
            keyboardType="number-pad"
            value={manualId}
            onChangeText={setManualId}
          />
          <AppButton
            label="进入会话"
            variant="secondary"
            disabled={openingPeerId != null}
            onPress={() => void openChat(Number(manualId), `用户 ${manualId}`)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.page },
  wrap: { flex: 1, padding: SPACING.md, gap: SPACING.sm },
  directory: { flex: 1 },
  manual: { gap: SPACING.xs, paddingTop: SPACING.xs },
  manualTitle: { color: COLORS.textSecondary, fontSize: TYPE.caption, fontWeight: '600' },
});
