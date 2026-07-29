import React from 'react';
import { Text, View } from 'react-native';

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
  const headSize = size * 0.23;
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
        overflow: 'hidden',
        backgroundColor: '#2563eb',
      }}
    >
      <View
        style={{
          position: 'absolute',
          width: headSize,
          height: headSize,
          borderRadius: headSize / 2,
          top: size * 0.23,
          left: size * 0.27,
          backgroundColor: '#dbeafe',
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: headSize,
          height: headSize,
          borderRadius: headSize / 2,
          top: size * 0.19,
          right: size * 0.23,
          backgroundColor: '#ffffff',
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.38,
          height: size * 0.24,
          borderTopLeftRadius: size * 0.19,
          borderTopRightRadius: size * 0.19,
          bottom: size * 0.19,
          left: size * 0.17,
          backgroundColor: '#dbeafe',
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.42,
          height: size * 0.27,
          borderTopLeftRadius: size * 0.21,
          borderTopRightRadius: size * 0.21,
          bottom: size * 0.16,
          right: size * 0.12,
          backgroundColor: '#ffffff',
        }}
      />
    </View>
  );
}
