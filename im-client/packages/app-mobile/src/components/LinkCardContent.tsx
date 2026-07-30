import React, { useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { normalizeLinkCard, type ChatMessage } from '@im/sdk-core';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

interface Props {
  body: ChatMessage['body'];
  onLongPress?: () => void;
  onOpenError: () => void;
}

export function LinkCardContent({ body, onLongPress, onOpenError }: Props) {
  const longPressedRef = useRef(false);
  const card = normalizeLinkCard(body?.link);
  if (card == null) return null;

  let hostname = '';
  try {
    hostname = new URL(card.url).hostname;
  } catch {
    return null;
  }

  const openLink = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    const safeCard = normalizeLinkCard(card);
    if (safeCard == null) {
      onOpenError();
      return;
    }
    Linking.openURL(safeCard.url).catch(onOpenError);
  };

  const handleLongPress = () => {
    longPressedRef.current = true;
    onLongPress?.();
  };

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`打开链接：${card.title}`}
      delayLongPress={350}
      onLongPress={handleLongPress}
      onPress={openLink}
      onPressIn={() => {
        longPressedRef.current = false;
      }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.site} numberOfLines={1}>
        {card.siteName ?? hostname}
      </Text>
      <Text style={styles.title} numberOfLines={2}>{card.title}</Text>
      {card.description == null ? null : (
        <Text style={styles.description} numberOfLines={2}>
          {card.description}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 210,
    maxWidth: '100%',
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    gap: SPACING.xxs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderStrong,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceMuted,
  },
  pressed: { opacity: 0.72 },
  site: {
    color: COLORS.textSecondary,
    fontSize: TYPE.caption,
    lineHeight: 17,
  },
  title: {
    color: COLORS.text,
    fontSize: TYPE.body,
    lineHeight: 20,
    fontWeight: '700',
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: TYPE.caption,
    lineHeight: 17,
  },
});
