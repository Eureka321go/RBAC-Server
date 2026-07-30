export interface TextSelection {
  start: number;
  end: number;
}

export interface TextEditResult {
  text: string;
  selection: TextSelection;
}

interface SegmentPart {
  index: number;
  segment: string;
}

interface SegmenterLike {
  segment(input: string): Iterable<SegmentPart>;
}

type SegmenterConstructor = new (
  locale?: string,
  options?: { granularity: 'grapheme' },
) => SegmenterLike;

interface PreviousCodePoint {
  start: number;
  value: number;
}

function normalizeSelection(text: string, selection: TextSelection): TextSelection {
  const start = Math.max(
    0,
    Math.min(text.length, Math.min(selection.start, selection.end)),
  );
  const end = Math.max(
    start,
    Math.min(text.length, Math.max(selection.start, selection.end)),
  );
  return { start, end };
}

function codePointBefore(text: string, end: number): PreviousCodePoint | null {
  if (end <= 0) return null;
  let start = end - 1;
  const trailing = text.charCodeAt(start);
  if (trailing >= 0xdc00 && trailing <= 0xdfff && start > 0) {
    const leading = text.charCodeAt(start - 1);
    if (leading >= 0xd800 && leading <= 0xdbff) start -= 1;
  }
  return { start, value: text.codePointAt(start) as number };
}

function isGraphemeExtender(value: number): boolean {
  return value === 0xfe0e
    || value === 0xfe0f
    || value === 0x20e3
    || (value >= 0x1f3fb && value <= 0x1f3ff)
    || (value >= 0xe0020 && value <= 0xe007f)
    || (value >= 0x0300 && value <= 0x036f)
    || (value >= 0x1ab0 && value <= 0x1aff)
    || (value >= 0x1dc0 && value <= 0x1dff)
    || (value >= 0x20d0 && value <= 0x20ff)
    || (value >= 0xfe20 && value <= 0xfe2f);
}

function isRegionalIndicator(value: number): boolean {
  return value >= 0x1f1e6 && value <= 0x1f1ff;
}

function previousEmojiComponentStart(text: string, end: number): number {
  let previous = codePointBefore(text, end);
  if (previous == null) return 0;
  let start = previous.start;
  while (isGraphemeExtender(previous.value)) {
    previous = codePointBefore(text, start);
    if (previous == null) return 0;
    start = previous.start;
  }
  if (isRegionalIndicator(previous.value)) {
    const paired = codePointBefore(text, start);
    if (paired != null && isRegionalIndicator(paired.value)) start = paired.start;
  }
  return start;
}

function previousGraphemeStartFallback(text: string, cursor: number): number {
  let start = previousEmojiComponentStart(text, cursor);
  let joiner = codePointBefore(text, start);
  while (joiner?.value === 0x200d) {
    start = previousEmojiComponentStart(text, joiner.start);
    joiner = codePointBefore(text, start);
  }
  return start;
}

function previousGraphemeStart(text: string, cursor: number): number {
  const prefix = text.slice(0, cursor);
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (Segmenter != null) {
    let lastStart = 0;
    for (const part of new Segmenter(undefined, { granularity: 'grapheme' }).segment(prefix)) {
      lastStart = part.index;
    }
    return lastStart;
  }
  return previousGraphemeStartFallback(text, cursor);
}

export function replaceSelection(
  text: string,
  selection: TextSelection,
  replacement: string,
): TextEditResult {
  const range = normalizeSelection(text, selection);
  const cursor = range.start + replacement.length;
  return {
    text: `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`,
    selection: { start: cursor, end: cursor },
  };
}

export function deleteBackward(text: string, selection: TextSelection): TextEditResult {
  const range = normalizeSelection(text, selection);
  if (range.start !== range.end) return replaceSelection(text, range, '');
  if (range.start === 0) return { text, selection: range };
  return replaceSelection(
    text,
    { start: previousGraphemeStart(text, range.start), end: range.start },
    '',
  );
}
