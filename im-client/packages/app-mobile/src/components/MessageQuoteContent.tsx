import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Ionicons,
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons/static';
import type { MessageQuote, QuotedMessageType } from '@im/sdk-core';
import { IconButton } from './IconButton';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

interface Props {
  quote: MessageQuote;
  mode: 'composer' | 'message';
  recalled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onClose?: () => void;
}

function iconName(type: QuotedMessageType): IoniconsIconName {
  switch (type) {
    case 'IMAGE': return 'image-outline';
    case 'FILE': return 'document-outline';
    case 'AUDIO': return 'mic-outline';
    default: return 'chatbox-outline';
  }
}

export function MessageQuoteContent({
  quote,
  mode,
  recalled = false,
  onPress,
  onLongPress,
  onClose,
}: Props) {
  const longPressedRef = useRef(false);
  const content = recalled ? (
    <Text style={styles.recalled}>原消息已撤回</Text>
  ) : (
    <>
      <View style={styles.heading}>
        <Ionicons name={iconName(quote.type)} size={14} color={COLORS.primary} />
        <Text style={styles.sender} numberOfLines={1}>{quote.senderName}</Text>
      </View>
      <Text style={styles.summary} numberOfLines={1}>{quote.summary}</Text>
    </>
  );

  if (mode === 'composer') {
    return (
      <View style={styles.composerWrap}>
        <View style={styles.content}>{content}</View>
        <IconButton
          name="close"
          accessibilityLabel="取消引用"
          size={18}
          color={COLORS.textSecondary}
          onPress={() => onClose?.()}
          style={styles.closeButton}
        />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole={recalled ? 'text' : 'button'}
      accessibilityLabel={recalled
        ? '原消息已撤回'
        : `查看引用消息：${quote.senderName}，${quote.summary}`}
      disabled={recalled || onPress == null}
      delayLongPress={350}
      onLongPress={recalled ? undefined : () => {
        longPressedRef.current = true;
        onLongPress?.();
      }}
      onPress={recalled ? undefined : () => {
        if (longPressedRef.current) {
          longPressedRef.current = false;
          return;
        }
        onPress?.();
      }}
      onPressIn={() => {
        longPressedRef.current = false;
      }}
      style={({ pressed }) => [styles.messageWrap, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  composerWrap: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.sm,
    marginTop: SPACING.xs,
    paddingLeft: SPACING.sm,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceMuted,
  },
  messageWrap: {
    minWidth: 180,
    maxWidth: '100%',
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.xxs,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.52)',
  },
  content: { flex: 1, gap: SPACING.xxs },
  heading: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs },
  sender: { flex: 1, color: COLORS.primary, fontSize: TYPE.caption, fontWeight: '700' },
  summary: { color: COLORS.textSecondary, fontSize: TYPE.caption, lineHeight: 17 },
  recalled: { color: COLORS.textMuted, fontSize: TYPE.caption, fontStyle: 'italic' },
  closeButton: { width: 40, height: 40 },
  pressed: { opacity: 0.68 },
});
