import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import { ConversationMuteSetting } from '../components/ConversationMuteSetting';
import type { RootStackParamList } from '../navigation/types';
import { COLORS, SPACING, TYPE } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ConversationSettings'>;

export function ConversationSettingsScreen({ route, navigation }: Props) {
  return (
    <View style={styles.page}>
      <CompactScreenHeader title="会话设置" onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>{route.params.title}</Text>
        <Text style={styles.subtitle}>仅影响当前账号在此会话中的提醒方式</Text>
        <ConversationMuteSetting cid={route.params.cid} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.page },
  content: { padding: SPACING.md, gap: SPACING.sm },
  title: { color: COLORS.text, fontSize: TYPE.title, fontWeight: '800' },
  subtitle: {
    marginBottom: SPACING.sm,
    color: COLORS.textSecondary,
    fontSize: TYPE.body,
  },
});
