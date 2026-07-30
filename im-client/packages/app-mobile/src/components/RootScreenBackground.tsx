import React, { type PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../ui/ThemeProvider';

export function RootScreenBackground({ children }: PropsWithChildren) {
  const { theme } = useAppTheme();
  return (
    <LinearGradient
      colors={[
        theme.colors.surface,
        theme.colors.pageAccent,
        theme.colors.page,
      ]}
      locations={[0, 0.34, 1]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.page}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
});
