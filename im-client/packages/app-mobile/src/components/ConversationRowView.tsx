import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConversationRow } from '@im/sdk-core';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
import { AnimatedEntrance } from './AnimatedEntrance';
import { GroupAvatar, InitialAvatar } from './Avatar';

interface Props {
  row: ConversationRow;
  title: string;
  formattedTime: string;
  onPress: () => void;
  entranceIndex: number;
}

export function ConversationRowView({
  row,
  title,
  formattedTime,
  onPress,
  entranceIndex,
}: Props) {
  const { theme } = useAppTheme();
  const preview = row.lastMsgPreview || '暂无消息';
  const accessibilityLabel = [
    title,
    row.muted ? '已开启消息免打扰' : null,
    row.hasMention ? '有人@我' : null,
    preview,
    row.unreadCount > 0 ? `${row.unreadCount} 条未读` : null,
  ].filter(Boolean).join('，');

  return (
    <AnimatedEntrance index={entranceIndex}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          { borderBottomColor: theme.colors.border },
          pressed && { backgroundColor: theme.colors.surfaceMuted },
        ]}
      >
        <View style={styles.avatarSlot}>
          {row.type === 'GROUP' ? (
            <GroupAvatar size={50} />
          ) : (
            <InitialAvatar name={title} userId={row.peerId} size={50} />
          )}
          {row.unreadCount > 0 ? (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: theme.colors.danger,
                  borderColor: theme.colors.surface,
                },
              ]}
            >
              <Text style={[styles.badgeText, { color: theme.colors.white }]}>
                {row.unreadCount > 99 ? '99+' : row.unreadCount}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.content}>
          <View style={styles.titleLine}>
            <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            {formattedTime ? (
              <Text style={[styles.time, { color: theme.colors.textMuted }]}>{formattedTime}</Text>
            ) : null}
          </View>
          <View style={styles.previewLine}>
            {row.hasMention ? (
              <Text style={[styles.mention, { color: theme.colors.primary }]}>[有人@我]</Text>
            ) : null}
            <Text style={[styles.preview, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {preview}
            </Text>
            {row.muted ? (
              <Ionicons name="volume-mute-outline" size={16} color={theme.colors.textMuted} />
            ) : null}
          </View>
        </View>
      </Pressable>
    </AnimatedEntrance>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 78,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarSlot: { position: 'relative' },
  content: { flex: 1, minWidth: 0, gap: 7 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  title: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '800' },
  time: { fontSize: 11, fontWeight: '500' },
  previewLine: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  mention: { flexShrink: 0, fontSize: TYPE.caption, fontWeight: '700' },
  preview: { flex: 1, minWidth: 0, fontSize: 13 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  badgeText: { fontSize: 10, fontWeight: '800' },
});
