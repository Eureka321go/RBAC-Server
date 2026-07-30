import React from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { routeMediaUrl } from '../sdk';
import { IconButton } from './IconButton';
import { SPACING } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

interface Props {
  uri: string | null;
  onClose: () => void;
}

export function ImagePreviewModal({ uri, onClose }: Props) {
  const { theme } = useAppTheme();
  return (
    <Modal
      visible={uri != null}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭图片预览"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        {uri != null ? (
          <Image source={routeMediaUrl(uri)} resizeMode="contain" style={styles.image} />
        ) : null}
        <IconButton
          name="close"
          accessibilityLabel="关闭图片预览"
          color={theme.colors.white}
          backgroundColor="rgba(15,23,42,0.58)"
          onPress={onClose}
          style={styles.close}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  image: { width: '100%', height: '100%' },
  close: { position: 'absolute', top: SPACING.xxl, right: SPACING.md },
});
