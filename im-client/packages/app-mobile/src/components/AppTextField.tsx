import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
}

export function AppTextField({ label, error, style, onFocus, onBlur, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        {...props}
        placeholderTextColor={COLORS.textMuted}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, focused && styles.focused, error && styles.invalid, style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs },
  label: { color: COLORS.text, fontSize: TYPE.body, fontWeight: '600' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    fontSize: TYPE.body,
  },
  focused: { borderColor: COLORS.primary, borderWidth: 1.5 },
  invalid: { borderColor: COLORS.danger },
  error: { color: COLORS.danger, fontSize: TYPE.caption },
});
