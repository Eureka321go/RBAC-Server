import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { sdk } from '../sdk';
import { RADIUS, SPACING, TYPE } from '../ui/theme';
import { useAppTheme } from '../ui/ThemeProvider';
import { StatusNotice } from './StatusNotice';
import { Surface } from './Surface';

interface Props {
  cid: string;
}

/** 会话级免打扰设置；单聊设置页与群设置页共享同一状态链路。 */
export function ConversationMuteSetting({ cid }: Props) {
  const { theme } = useAppTheme();
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const reload = useCallback(async () => {
    try {
      const rows = await sdk.sync.getConversations();
      if (!mountedRef.current) return;
      const conversation = rows.find((row) => row.cid === cid);
      if (conversation == null) {
        setError('暂时无法读取会话设置，请返回后重试');
        return;
      }
      setMuted(conversation.muted);
      setError(null);
    } catch (cause) {
      if (mountedRef.current) {
        const message = cause instanceof Error ? cause.message : '未知错误';
        setError(`读取会话设置失败：${message}`);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [cid]);

  useEffect(() => {
    mountedRef.current = true;
    reload().catch(() => undefined);
    const offConversation = sdk.chat.on('conversation', (payload) => {
      if (payload.cid === cid) reload().catch(() => undefined);
    });
    return () => {
      mountedRef.current = false;
      offConversation();
    };
  }, [cid, reload]);

  const updateMuted = useCallback(async (nextMuted: boolean) => {
    if (saving || loading) return;
    setSaving(true);
    setError(null);
    try {
      await sdk.sync.setConversationMuted(cid, nextMuted);
      await reload();
    } catch (cause) {
      if (mountedRef.current) {
        const message = cause instanceof Error ? cause.message : '未知错误';
        setError(`设置消息免打扰失败：${message}`);
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [cid, loading, reload, saving]);

  return (
    <View style={styles.wrap}>
      {error ? <StatusNotice message={error} tone="error" /> : null}
      <Surface>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="volume-mute-outline" size={21} color={theme.colors.primary} />
          </View>
          <View style={styles.textWrap}>
            <Text style={[styles.label, { color: theme.colors.text }]}>消息免打扰</Text>
            <Text style={[styles.description, { color: theme.colors.textSecondary }]}>消息仍会正常接收，并保留未读与 @ 提醒</Text>
          </View>
          <Switch
            accessibilityLabel="消息免打扰"
            disabled={loading || saving}
            value={muted}
            trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primarySoft }}
            thumbColor={muted ? theme.colors.primary : theme.colors.white}
            ios_backgroundColor={theme.colors.borderStrong}
            onValueChange={updateMuted}
          />
        </View>
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACING.sm },
  row: {
    minHeight: 76,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1, minWidth: 0 },
  label: { fontSize: TYPE.body, fontWeight: '700' },
  description: {
    marginTop: 3,
    fontSize: TYPE.caption,
    lineHeight: 17,
  },
});
