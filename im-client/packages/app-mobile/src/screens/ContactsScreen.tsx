import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  Pressable,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { buildSingleCid } from '@im/sdk-core';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import type { RootStackParamList } from '../navigation/types';

interface UserRow {
  id: number;
  username: string;
  nickname: string;
}

interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

interface PageResult<T> {
  records: T[];
  total: number;
}

type Props = NativeStackScreenProps<RootStackParamList, 'Contacts'>;

export function ContactsScreen({ navigation }: Props) {
  const myId = useAppStore((s) => s.myId);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');

  const openChat = useCallback(
    (peerId: number, peerName: string) => {
      if (myId == null || peerId === myId || !Number.isFinite(peerId)) return;
      navigation.replace('Chat', {
        cid: buildSingleCid(myId, peerId),
        title: peerName,
        // 新会话尚未在服务端建 membership，第一次发送成功前不能拉历史。
        syncOnOpen: false,
      });
    },
    [myId, navigation],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await sdk.http.get<ApiResult<PageResult<UserRow>>>('/system/users', {
          page: 1,
          pageSize: 50,
        });
        if (!alive) return;
        const list = (res.data?.records ?? []).filter((u) => u.id !== myId);
        setUsers(list);
        if (list.length === 0) {
          setHint('没有可选联系人（可能受数据权限过滤），可在下方直接输入对端 userId。');
        }
      } catch {
        if (alive) {
          setHint('拉取用户列表失败（缺少 system:user:list 权限？），请在下方直接输入对端 userId。');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [myId]);

  return (
    <View style={styles.wrap}>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => openChat(item.id, item.nickname || item.username)}>
            <Text style={styles.name}>{item.nickname || item.username}</Text>
            <Text style={styles.sub}>#{item.id}</Text>
          </Pressable>
        )}
      />
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
          onPress={() => openChat(Number(manualId), `用户 ${manualId}`)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  hint: { color: '#b45309', fontSize: 13 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  name: { fontSize: 16 },
  sub: { fontSize: 12, color: '#6b7280' },
  manual: { gap: 8 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12 },
});
