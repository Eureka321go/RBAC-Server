import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import type { ChatMessage } from '@im/sdk-core';
import { displayableImageUri, formatBytes, safeFilename } from '../media/mediaPresentation';
import { routeMediaUrl } from '../sdk';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';

interface Props {
  message: ChatMessage;
  onPreview: (uri: string) => void;
  onRefreshImage: (objectKey: string, filename: string) => Promise<string>;
  onOpenFile: (message: ChatMessage) => void;
  onLongPress?: () => void;
  downloading: boolean;
  downloadProgress: number;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function progressOf(message: ChatMessage): number {
  const value = message.body?.progress;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function ImageMessage({ message, onPreview, onRefreshImage, onLongPress }: Pick<Props,
  'message' | 'onPreview' | 'onRefreshImage' | 'onLongPress'
>) {
  const { theme } = useAppTheme();
  const objectKey = typeof message.body?.objectKey === 'string' ? message.body.objectKey : null;
  const filename = safeFilename(message.body?.filename);
  // 有 objectKey 的远程图片统一先落缓存，避免把短期预签名 URL 直接交给原生图片管线。
  const initialUri = displayableImageUri(
    message.body?.localUri ?? (objectKey == null ? message.body?.url : null),
  );
  const [uri, setUri] = useState(initialUri);
  const failedUriRef = useRef<string | null>(null);
  const longPressedRef = useRef(false);
  useEffect(() => {
    setUri(initialUri);
    failedUriRef.current = null;
  }, [initialUri, objectKey]);
  const dimensions = useMemo(() => {
    const width = positiveNumber(message.body?.width) ?? 4;
    const height = positiveNumber(message.body?.height) ?? 3;
    const ratio = width / height;
    if (ratio >= 1) return { width: 220, height: Math.max(120, Math.min(280, 220 / ratio)) };
    return { width: Math.max(140, Math.min(220, 280 * ratio)), height: 280 };
  }, [message.body?.height, message.body?.width]);
  const uploading = message.status === 'uploading';
  const progress = progressOf(message);

  const refresh = useCallback(() => {
    if (objectKey == null || (uri != null && failedUriRef.current === uri)) return;
    failedUriRef.current = uri ?? '__missing__';
    void onRefreshImage(objectKey, filename)
      .then((next) => setUri(displayableImageUri(next)))
      .catch(() => {});
  }, [filename, objectKey, onRefreshImage, uri]);

  useEffect(() => {
    if (uri == null && objectKey != null) refresh();
  }, [objectKey, refresh, uri]);

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="查看图片"
      disabled={uri == null && onLongPress == null}
      delayLongPress={350}
      onLongPress={() => {
        longPressedRef.current = true;
        onLongPress?.();
      }}
      onPress={() => {
        if (longPressedRef.current) {
          longPressedRef.current = false;
          return;
        }
        if (uri != null) onPreview(uri);
      }}
      onPressIn={() => {
        longPressedRef.current = false;
      }}
      style={[styles.imageWrap, { backgroundColor: theme.colors.surfaceMuted }, dimensions]}
    >
      {uri != null ? (
        <Image
          source={routeMediaUrl(uri)}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          onError={refresh}
        />
      ) : (
        <Ionicons name="image-outline" size={34} color={theme.colors.textMuted} />
      )}
      {uploading ? (
        <View style={styles.uploadOverlay}>
          <Text style={[styles.uploadText, { color: theme.colors.white }]}>{Math.round(progress * 100)}%</Text>
          <View style={[styles.progressTrack, { backgroundColor: theme.colors.borderStrong }]}>
            <View style={[
              styles.progressFill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.colors.primary },
            ]} />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

function FileMessage({ message, onOpenFile, onLongPress, downloading, downloadProgress }: Pick<Props,
  'message' | 'onOpenFile' | 'onLongPress' | 'downloading' | 'downloadProgress'
>) {
  const { theme } = useAppTheme();
  const longPressedRef = useRef(false);
  const uploadProgress = progressOf(message);
  const progress = downloading ? downloadProgress : uploadProgress;
  const busy = downloading || message.status === 'uploading';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开文件 ${safeFilename(message.body?.filename)}`}
      disabled={message.status === 'uploading'}
      delayLongPress={350}
      onLongPress={() => {
        longPressedRef.current = true;
        onLongPress?.();
      }}
      onPress={() => {
        if (longPressedRef.current) {
          longPressedRef.current = false;
          return;
        }
        onOpenFile(message);
      }}
      onPressIn={() => {
        longPressedRef.current = false;
      }}
      style={({ pressed }) => [styles.fileCard, pressed && styles.pressed]}
    >
      <View style={[styles.fileIcon, { backgroundColor: theme.colors.primarySoft }]}>
        {downloading ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Ionicons name="document-text-outline" size={28} color={theme.colors.primary} />
        )}
      </View>
      <View style={styles.fileMeta}>
        <Text style={[styles.filename, { color: theme.colors.text }]} numberOfLines={2}>{safeFilename(message.body?.filename)}</Text>
        <Text style={[styles.fileSize, { color: theme.colors.textSecondary }]}>{formatBytes(message.body?.size)}</Text>
        {busy ? (
          <View style={[styles.progressTrack, { backgroundColor: theme.colors.borderStrong }]}>
            <View style={[
              styles.progressFill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.colors.primary },
            ]} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function MediaMessageContent(props: Props) {
  if (props.message.type === 'IMAGE') {
    return <ImageMessage {...props} />;
  }
  return <FileMessage {...props} />;
}

const styles = StyleSheet.create({
  imageWrap: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
  },
  uploadOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    backgroundColor: 'rgba(15,23,42,0.42)',
  },
  uploadText: { fontSize: TYPE.caption, fontWeight: '800' },
  progressTrack: {
    width: '100%',
    height: 4,
    overflow: 'hidden',
    borderRadius: RADIUS.pill,
  },
  progressFill: { height: '100%', borderRadius: RADIUS.pill },
  fileCard: { minWidth: 210, maxWidth: 250, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  fileIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
  },
  fileMeta: { flex: 1, gap: SPACING.xxs },
  filename: { fontSize: TYPE.body, fontWeight: '700' },
  fileSize: { fontSize: TYPE.caption },
  pressed: { opacity: 0.68 },
});
