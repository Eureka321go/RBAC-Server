import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SPACING } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
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
  const { theme } = useAppTheme();
  return (
    <View style={[
      styles.panel,
      { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
    ]}>
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
            style={({ pressed }) => [
              styles.cell,
              pressed && { backgroundColor: theme.colors.surfaceMuted },
            ]}
          >
            <Text style={styles.emoji}>{item}</Text>
          </Pressable>
        )}
      />
      <View style={[
        styles.toolbar,
        { borderTopColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
      ]}>
        <IconButton
          name="backspace-outline"
          accessibilityLabel="删除前一个字符"
          color={theme.colors.textSecondary}
          onPress={onDelete}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    height: 240,
    borderTopWidth: StyleSheet.hairlineWidth,
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
  emoji: { fontSize: 28, lineHeight: 34 },
  toolbar: {
    minHeight: 52,
    paddingHorizontal: SPACING.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
