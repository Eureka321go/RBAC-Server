import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GroupAvatar, InitialAvatar } from './Avatar';
import { IconButton } from './IconButton';
import { PresenceDot } from './PresenceDot';
import { SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

interface Props {
  title: string;
  subtitle: string;
  isGroup: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
}

export function ChatHeader({ title, subtitle, isGroup, onBack, onOpenSettings }: Props) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.header, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
      <IconButton name="chevron-back" accessibilityLabel="返回" onPress={onBack} />
      {isGroup ? <GroupAvatar size={38} /> : <InitialAvatar name={title} size={38} />}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>{title}</Text>
        <View style={styles.subtitleLine}>
          <PresenceDot color={theme.colors.success} size={6} />
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>
      <IconButton
        name="settings-outline"
        accessibilityLabel={isGroup ? '群设置' : '会话设置'}
        backgroundColor={theme.colors.surfaceMuted}
        color={theme.colors.primary}
        onPress={onOpenSettings}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 64,
    paddingHorizontal: SPACING.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: TYPE.body, fontWeight: '800' },
  subtitleLine: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 5 },
  subtitle: { flex: 1, minWidth: 0, fontSize: 10, fontWeight: '600' },
});
