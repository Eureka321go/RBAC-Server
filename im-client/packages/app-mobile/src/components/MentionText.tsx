import React from 'react';
import { StyleSheet, Text } from 'react-native';
import type { ChatMessage } from '@im/sdk-core';
import { COLORS, TYPE } from '../ui/theme';

type Segment = { text: string; mentioned: boolean };

function plainText(text: string): Segment[] {
  return [{ text, mentioned: false }];
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function parseMentionSegments(body: ChatMessage['body']): Segment[] {
  const text = typeof body?.text === 'string' ? body.text : '';
  const rawRanges = body?.mentionRanges;
  if (!Array.isArray(rawRanges) || rawRanges.length === 0) return plainText(text);

  const mentions = new Set(
    Array.isArray(body?.mentions)
      ? body.mentions.filter((value): value is number => isSafeInteger(value) && value > 0)
      : [],
  );
  const mentionAll = body?.mentionAll === true;
  const ranges: Array<{ start: number; end: number }> = [];
  let previousEnd = 0;

  for (const rawRange of rawRanges) {
    if (rawRange == null || typeof rawRange !== 'object' || Array.isArray(rawRange)) {
      return plainText(text);
    }
    const range = rawRange as Record<string, unknown>;
    const { start, end } = range;
    if (
      !isSafeInteger(start)
      || !isSafeInteger(end)
      || start < 0
      || end <= start
      || end > text.length
      || start < previousEnd
      || text[start] !== '@'
    ) {
      return plainText(text);
    }

    const targetsAll = range.mentionAll === true;
    const userId = range.userId;
    const targetsUser = isSafeInteger(userId) && userId > 0;
    if (
      targetsAll === targetsUser
      || (targetsAll && !mentionAll)
      || (targetsUser && !mentions.has(userId))
    ) {
      return plainText(text);
    }
    ranges.push({ start, end });
    previousEnd = end;
  }

  const segments: Segment[] = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (cursor < range.start) {
      segments.push({ text: text.slice(cursor, range.start), mentioned: false });
    }
    segments.push({ text: text.slice(range.start, range.end), mentioned: true });
    cursor = range.end;
  });
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mentioned: false });
  return segments;
}

interface Props {
  body: ChatMessage['body'];
}

export function MentionText({ body }: Props) {
  const segments = parseMentionSegments(body);
  return (
    <Text style={styles.text}>
      {segments.map((segment, index) => (
        <Text
          key={`${index}:${segment.text.length}`}
          style={segment.mentioned ? styles.mentioned : undefined}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { color: COLORS.text, fontSize: TYPE.body, lineHeight: 21 },
  mentioned: { color: COLORS.mention, fontWeight: '700' },
});
