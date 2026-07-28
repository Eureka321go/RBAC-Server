import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

interface Props {
  title: string;
  onBack: () => void;
}

/** 替代 Android edge-to-edge 下过高的 native-stack Header。 */
export function CompactScreenHeader({ title, onBack }: Props) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="返回"
        hitSlop={8}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        onPress={onBack}
      >
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={styles.balance} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 60,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: '#f1f5f9' },
  backText: { color: '#0f172a', fontSize: 38, lineHeight: 40, marginTop: -3 },
  title: {
    flex: 1,
    textAlign: 'center',
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '700',
  },
  balance: { width: 44 },
});
