import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AnimatedEntrance } from '../components/AnimatedEntrance';
import { AppearanceSelector } from '../components/AppearanceSelector';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import { RootScreenBackground } from '../components/RootScreenBackground';
import { Surface } from '../components/Surface';
import type { RootStackParamList } from '../navigation/types';
import { SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'AppearanceSettings'>;

export function AppearanceSettingsScreen({ navigation }: Props) {
  const { theme } = useAppTheme();

  return (
    <RootScreenBackground>
      <CompactScreenHeader title="外观" onBack={() => navigation.goBack()} />
      <AnimatedEntrance style={styles.content}>
        <View>
          <Text style={[styles.title, { color: theme.colors.text }]}>
            选择界面模式
          </Text>
          <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
            设置会立即生效并自动保存
          </Text>
        </View>
        <Surface style={styles.card}>
          <AppearanceSelector />
        </Surface>
      </AnimatedEntrance>
    </RootScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: SPACING.md, gap: SPACING.md },
  title: { fontSize: TYPE.title, fontWeight: '800' },
  hint: { marginTop: SPACING.xxs, fontSize: TYPE.caption },
  card: { padding: SPACING.sm },
});
