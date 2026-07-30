import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InitialAvatar } from '../components/Avatar';
import { useAppStore } from '../store';
import { SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

export function ProfileScreen() {
  const myId = useAppStore((state) => state.myId);
  const displayName = useAppStore((state) => state.displayName);
  const { theme } = useAppTheme();

  return (
    <View style={[styles.page, { backgroundColor: theme.colors.page }]}>
      <Text style={[styles.title, { color: theme.colors.text }]}>我的</Text>
      <View style={styles.identity}>
        <InitialAvatar name={displayName} userId={myId} size={58} />
        <View style={styles.identityText}>
          <Text style={[styles.name, { color: theme.colors.text }]}>
            {displayName || `用户 #${myId ?? ''}`}
          </Text>
          <Text style={[styles.id, { color: theme.colors.textSecondary }]}>IM ID · {myId ?? '—'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: SPACING.lg },
  title: { marginTop: SPACING.sm, fontSize: TYPE.hero, lineHeight: 36, fontWeight: '900' },
  identity: { marginTop: SPACING.xl, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  identityText: { flex: 1, gap: SPACING.xxs },
  name: { fontSize: TYPE.subtitle, fontWeight: '800' },
  id: { fontSize: TYPE.caption },
});
