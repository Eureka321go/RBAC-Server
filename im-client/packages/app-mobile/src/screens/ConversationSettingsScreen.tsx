import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import { ConversationMuteSetting } from '../components/ConversationMuteSetting';
import { AnimatedEntrance } from '../components/AnimatedEntrance';
import type { RootStackParamList } from '../navigation/types';
import { SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'ConversationSettings'>;

export function ConversationSettingsScreen({ route, navigation }: Props) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.page, { backgroundColor: theme.colors.page }]}>
      <CompactScreenHeader title="会话设置" onBack={() => navigation.goBack()} />
      <AnimatedEntrance style={styles.content}>
        <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>{route.params.title}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>仅影响当前账号在此会话中的提醒方式</Text>
        <ConversationMuteSetting cid={route.params.cid} />
      </AnimatedEntrance>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: SPACING.md, gap: SPACING.sm },
  title: { fontSize: TYPE.title, fontWeight: '800' },
  subtitle: {
    marginBottom: SPACING.sm,
    fontSize: TYPE.body,
  },
});
