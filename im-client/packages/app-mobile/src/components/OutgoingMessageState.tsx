import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { ChatMessage } from '@im/sdk-core';
import { COLORS } from '../ui/theme';
import { IconButton } from './IconButton';

interface Props {
  message: ChatMessage;
  recalling: boolean;
  onCancelUpload: () => void;
  onRetry: () => void;
}

/** 己方气泡左侧的互斥状态槽位；同一条消息最多展示一个状态。 */
export function OutgoingMessageState({
  message,
  recalling,
  onCancelUpload,
  onRetry,
}: Props) {
  if (message.status === 'failed' && message.clientMsgId != null) {
    return (
      <View style={styles.slot}>
        <IconButton
          name="alert-circle"
          accessibilityLabel="重新发送"
          color={COLORS.danger}
          onPress={onRetry}
        />
      </View>
    );
  }

  if (message.status === 'uploading') {
    const uploadTaskId = message.body?.uploadTaskId;
    return (
      <View style={styles.slot}>
        {typeof uploadTaskId === 'string' ? (
          <IconButton
            name="close-circle-outline"
            accessibilityLabel="取消上传"
            color={COLORS.textSecondary}
            onPress={onCancelUpload}
          />
        ) : (
          <ActivityIndicator size="small" color={COLORS.textMuted} />
        )}
      </View>
    );
  }

  if (message.status === 'sending' || message.status === 'acked' || recalling) {
    return (
      <View style={styles.slot}>
        <ActivityIndicator size="small" color={COLORS.textMuted} />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  slot: {
    width: 44,
    minHeight: 44,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
