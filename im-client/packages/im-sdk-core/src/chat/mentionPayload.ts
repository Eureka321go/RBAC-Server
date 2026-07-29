export type TextMentionRange =
  | { userId: number; start: number; end: number }
  | { mentionAll: true; start: number; end: number };

export interface SendTextOptions {
  mentions?: readonly number[];
  mentionAll?: boolean;
  mentionRanges?: readonly TextMentionRange[];
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizeMentions(mentions: readonly number[] | undefined): number[] {
  if (mentions == null) return [];
  return [...new Set(mentions.filter(isPositiveSafeInteger))];
}

function isValidRange(text: string, start: number, end: number): boolean {
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= text.length &&
    text.startsWith('@', start)
  );
}

export function buildTextMessageBody(
  text: string,
  options: SendTextOptions = {},
): Record<string, unknown> {
  const mentionAll = options.mentionAll === true;
  const mentions = mentionAll ? [] : normalizeMentions(options.mentions);
  const validUserIds = new Set(mentions);
  const ranges = (options.mentionRanges ?? [])
    .filter((range) => {
      if (!isValidRange(text, range.start, range.end)) return false;
      return 'mentionAll' in range ? mentionAll : validUserIds.has(range.userId);
    })
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<TextMentionRange[]>((validRanges, range) => {
      const lastRange = validRanges[validRanges.length - 1];
      if (lastRange == null || lastRange.end <= range.start) validRanges.push(range);
      return validRanges;
    }, []);

  if (!mentionAll && mentions.length === 0) return { text };

  const body: Record<string, unknown> = { text };
  if (mentionAll) {
    body.mentionAll = true;
  } else {
    body.mentions = mentions;
  }
  if (ranges.length > 0) body.mentionRanges = ranges;
  return body;
}
