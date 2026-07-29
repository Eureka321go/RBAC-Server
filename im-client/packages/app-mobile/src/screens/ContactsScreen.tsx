import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import type { RootStackParamList } from '../navigation/types';
import { DepartmentContactPicker } from '../components/DepartmentContactPicker';
import { buildContactDirectory, type ContactDirectoryModel } from '../contact/directory';

type Props = NativeStackScreenProps<RootStackParamList, 'Contacts'>;

export function ContactsScreen({ navigation }: Props) {
  const myId = useAppStore((s) => s.myId);
  const [directory, setDirectory] = useState<ContactDirectoryModel | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const [openingPeerId, setOpeningPeerId] = useState<number | null>(null);
  const mountedRef = useRef(true);

  const openChat = useCallback(
    async (peerId: number, peerName: string) => {
      if (myId == null || peerId === myId || !Number.isFinite(peerId)) return;
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
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {directory ? (
          <DepartmentContactPicker
            model={directory}
            mode="single"
            excludedIds={new Set(myId == null ? [] : [myId])}
            disabled={openingPeerId != null}
            onMemberPress={(member) => void openChat(member.userId, member.displayName)}
          />
        ) : null}
        <View style={styles.manual}>
          <TextInput
            style={styles.input}
            placeholder="直接输入对端 userId"
            keyboardType="number-pad"
            value={manualId}
            onChangeText={setManualId}
          />
          <Button
            title="进入会话"
            disabled={openingPeerId != null}
            onPress={() => void openChat(Number(manualId), `用户 ${manualId}`)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' },
  wrap: { flex: 1, padding: 16, gap: 12 },
  hint: { color: '#b45309', fontSize: 13 },
  manual: { gap: 8 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12 },
});
