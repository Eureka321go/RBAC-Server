import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { AnimatedEntrance } from '../components/AnimatedEntrance';
import { CompactScreenHeader } from '../components/CompactScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { RootScreenBackground } from '../components/RootScreenBackground';
import { Surface } from '../components/Surface';
import type { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../ui/LanguageProvider';
import { SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
import type { AppLanguage } from '../ui/languagePreference';

type Props = NativeStackScreenProps<RootStackParamList, 'LanguageSettings'>;
const options: Array<{ language: AppLanguage; nativeName: string; label: string }> = [
  { language: 'zh-CN', nativeName: '简体中文', label: 'Simplified Chinese' },
  { language: 'en-US', nativeName: 'English', label: 'English' },
];

export function LanguageSettingsScreen({ navigation }: Props) {
  const { theme } = useAppTheme();
  const { language, setLanguage, t } = useLanguage();
  return <RootScreenBackground>
    <CompactScreenHeader title={t('language')} onBack={() => navigation.goBack()} />
    <AnimatedEntrance style={styles.content}>
      <View><Text style={[styles.title, { color: theme.colors.text }]}>{t('languageTitle')}</Text>
        <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>{t('languageHint')}</Text></View>
      <Surface style={styles.card}>{options.map(option => {
        const selected = option.language === language;
        return <PressableScale key={option.language} accessibilityRole="radio" accessibilityState={{ selected }}
          accessibilityLabel={option.nativeName} onPress={() => void setLanguage(option.language)}
          style={[styles.option, { backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceMuted, borderColor: selected ? theme.colors.primary : theme.colors.border }]}>
          <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name="language-outline" size={21} color={theme.colors.primary} /></View>
          <View style={styles.copy}><Text style={[styles.optionName, { color: selected ? theme.colors.primary : theme.colors.text }]}>{option.nativeName}</Text>
            {option.nativeName !== option.label ? <Text style={[styles.optionHint, { color: theme.colors.textSecondary }]}>{option.label}</Text> : null}</View>
          {selected ? <Ionicons name="checkmark-circle" size={23} color={theme.colors.primary} /> : null}
        </PressableScale>;
      })}</Surface>
    </AnimatedEntrance>
  </RootScreenBackground>;
}
const styles = StyleSheet.create({ content: { flex: 1, padding: SPACING.md, gap: SPACING.md }, title: { fontSize: TYPE.title, fontWeight: '800' }, hint: { marginTop: SPACING.xxs, fontSize: TYPE.caption }, card: { padding: SPACING.sm, gap: SPACING.xs }, option: { minHeight: 64, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.sm }, icon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1 }, optionName: { fontSize: TYPE.body, fontWeight: '700' }, optionHint: { marginTop: 2, fontSize: TYPE.caption } });
