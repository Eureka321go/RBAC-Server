import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, SPACING } from '../ui/theme';
import { IconButton } from './IconButton';

interface Props {
  onSelect(emoji: string): void;
  onDelete(): void;
}

const COMMON_EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
  '😊', '🙂', '🙃', '😉', '😍', '🥰', '😘', '😋',
  '😎', '🤓', '🧐', '🤔', '🤨', '😐', '😑', '😶',
  '🙄', '😏', '😣', '😥', '😮', '🤐', '😯', '😪',
  '😫', '🥱', '😴', '😌', '🤤', '😒', '😓', '😔',
  '😕', '🙁', '☹️', '😖', '😞', '😟', '😤', '😢',
  '😭', '😦', '😧', '😨', '😩', '🤯', '😬', '😰',
  '😱', '🥵', '🥶', '😳', '🤪', '😵', '🤢', '🤮',
  '👍', '👍🏻', '👎', '👏', '🙏', '💪', '👌', '✌️',
  '🤝', '👨‍👩‍👧‍👦', '❤️', '💔', '💕', '🎉', '🎂', '🔥',
];

export function EmojiPicker({ onSelect, onDelete }: Props) {
  return (
    <View style={styles.panel}>
      <FlatList
        data={COMMON_EMOJIS}
        numColumns={8}
        keyExtractor={(emoji, index) => `${index}:${emoji}`}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`插入表情 ${item}`}
            onPress={() => onSelect(item)}
            style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
          >
            <Text style={styles.emoji}>{item}</Text>
          </Pressable>
        )}
      />
      <View style={styles.toolbar}>
        <IconButton
          name="backspace-outline"
          accessibilityLabel="删除前一个字符"
          color={COLORS.textSecondary}
          onPress={onDelete}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    height: 240,
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  grid: {
    paddingHorizontal: SPACING.xxs,
    paddingVertical: SPACING.xs,
  },
  cell: {
    flex: 1,
    minWidth: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  cellPressed: { backgroundColor: COLORS.surfaceMuted },
  emoji: { fontSize: 28, lineHeight: 34 },
  toolbar: {
    minHeight: 52,
    paddingHorizontal: SPACING.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surfaceMuted,
  },
});
