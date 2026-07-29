import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { COLORS } from '../ui/theme';

const USER_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#16a34a'] as const;

interface AvatarProps {
  name?: string | null;
  userId?: number | null;
  size?: number;
}

function initialOf(name?: string | null): string {
  const normalized = name?.trim();
  return normalized ? (Array.from(normalized)[0]?.toLocaleUpperCase() ?? 'U') : 'U';
}

function colorOf(userId?: number | null): string {
  const normalizedId = userId != null && Number.isFinite(userId) ? Math.trunc(userId) : 0;
  return USER_COLORS[Math.abs(normalizedId) % USER_COLORS.length];
}

export function InitialAvatar({ name, userId, size = 42 }: AvatarProps) {
  const initial = initialOf(name);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name?.trim() || '用户'}的头像`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        backgroundColor: colorOf(userId),
      }}
    >
      <Text style={{ color: '#ffffff', fontSize: size * 0.43, fontWeight: '700' }}>
        {initial}
      </Text>
    </View>
  );
}

export function GroupAvatar({ size = 42 }: Pick<AvatarProps, 'size'>) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="群聊头像"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        backgroundColor: COLORS.primary,
      }}
    >
      <Ionicons name="people" size={size * 0.54} color={COLORS.white} />
    </View>
  );
}
