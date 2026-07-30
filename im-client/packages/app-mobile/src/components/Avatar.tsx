import React from 'react';
import { StyleSheet, Text } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { useAppTheme } from '../ui/ThemeProvider';

const USER_GRADIENTS = [
  ['#4F75F6', '#9076F4'],
  ['#8058E8', '#B16EE9'],
  ['#E55E9C', '#FF8B72'],
  ['#F09A4B', '#F0C24B'],
  ['#2DAFC4', '#4A8EE8'],
  ['#2FB787', '#53C8BE'],
] as const;

interface AvatarProps {
  name?: string | null;
  userId?: number | null;
  size?: number;
}

function initialOf(name?: string | null): string {
  const normalized = name?.trim();
  return normalized ? (Array.from(normalized)[0]?.toLocaleUpperCase() ?? 'U') : 'U';
}

function gradientOf(userId?: number | null): readonly [string, string] {
  const normalizedId = userId != null && Number.isFinite(userId) ? Math.trunc(userId) : 0;
  return USER_GRADIENTS[Math.abs(normalizedId) % USER_GRADIENTS.length];
}

export function InitialAvatar({ name, userId, size = 42 }: AvatarProps) {
  const initial = initialOf(name);
  return (
    <LinearGradient
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name?.trim() || '用户'}的头像`}
      colors={[...gradientOf(userId)]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size * 0.34 },
      ]}
    >
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.4, fontWeight: '800' }}>
        {initial}
      </Text>
    </LinearGradient>
  );
}

export function GroupAvatar({ size = 42 }: Pick<AvatarProps, 'size'>) {
  const { theme } = useAppTheme();
  return (
    <LinearGradient
      accessible
      accessibilityRole="image"
      accessibilityLabel="群聊头像"
      colors={theme.isDark ? ['#765CFF', '#54D5C4'] : ['#5272EF', '#8C75F4']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size * 0.34 },
      ]}
    >
      <Ionicons name="people" size={size * 0.5} color={theme.colors.white} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
