import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { GroupDetail } from '@im/sdk-core';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import type { RootStackParamList } from '../navigation/types';
import { sdk } from '../sdk';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupDetails'>;

export function GroupDetailsScreen({ route, navigation }: Props) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void sdk.groups.getGroup(route.params.groupId).then((value) => {
      if (mounted) setDetail(value);
    }).catch((cause) => {
      if (mounted) setError(cause instanceof Error ? cause.message : '群资料加载失败');
    });
    return () => {
      mounted = false;
    };
  }, [route.params.groupId]);

  return (
    <View style={styles.page}>
      <CompactScreenHeader title={route.params.title} onBack={() => navigation.goBack()} />
      {detail ? (
        <View style={styles.card}>
          <Text style={styles.name}>{detail.name}</Text>
          <Text style={styles.meta}>{detail.memberCount} 位成员 · {detail.myRole}</Text>
        </View>
      ) : (
        <Text style={[styles.loading, error && styles.error]}>{error ?? '正在加载群资料…'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' },
  loading: { marginTop: 48, color: '#64748b', textAlign: 'center' },
  error: { color: '#b91c1c' },
  card: { margin: 16, padding: 16, borderRadius: 12, backgroundColor: '#ffffff' },
  name: { color: '#0f172a', fontSize: 20, fontWeight: '700' },
  meta: { color: '#64748b', fontSize: 13, marginTop: 6 },
});
