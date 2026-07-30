import type { SendTextOptions, TextMentionRange } from '@im/sdk-core';

export interface MentionDraftRange {
  userId?: number;
  mentionAll?: true;
  displayName: string;
  start: number;
  end: number;
}

export interface MentionDraftState {
  text: string;
  ranges: readonly MentionDraftRange[];
}

export interface MentionCandidate {
  userId: number;
  displayName: string;
}

export interface MentionTrigger {
  start: number;
  end: number;
}

export type MentionSelection =
  | MentionCandidate
  | readonly MentionCandidate[]
  | 'all'
  | { mentionAll: true };

interface TextChange {
  start: number;
  previousEnd: number;
  nextEnd: number;
}

function findTextChange(previousText: string, nextText: string): TextChange {
  let start = 0;
  const prefixLength = Math.min(previousText.length, nextText.length);
  while (start < prefixLength && previousText[start] === nextText[start]) start += 1;

  let suffixLength = 0;
  const previousRemaining = previousText.length - start;
  const nextRemaining = nextText.length - start;
  while (
    suffixLength < previousRemaining &&
    suffixLength < nextRemaining &&
    previousText[previousText.length - suffixLength - 1] ===
      nextText[nextText.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  return {
    start,
    previousEnd: previousText.length - suffixLength,
    nextEnd: nextText.length - suffixLength,
  };
}

function isPositiveSafeInteger(value: number | undefined): value is number {
  return value != null && Number.isSafeInteger(value) && value > 0;
}

function isEffectiveRange(text: string, range: MentionDraftRange): boolean {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start ||
    range.end > text.length ||
    text.slice(range.start, range.end) !== `@${range.displayName}`
  ) {
    return false;
  }
  return range.mentionAll === true || isPositiveSafeInteger(range.userId);
}

function isMentionAllSelection(selection: MentionSelection): selection is 'all' | { mentionAll: true } {
  return selection === 'all' || (!Array.isArray(selection) && 'mentionAll' in selection);
}

function asCandidates(selection: MentionSelection): readonly MentionCandidate[] {
  if (Array.isArray(selection)) return selection as readonly MentionCandidate[];
  return isMentionAllSelection(selection) ? [] : [selection as MentionCandidate];
}

function toTextMentionRange(range: MentionDraftRange): TextMentionRange {
  if (range.mentionAll === true) {
    return { mentionAll: true, start: range.start, end: range.end };
  }
  return { userId: range.userId as number, start: range.start, end: range.end };
}

export function findInsertedMentionTrigger(
  previousText: string,
  nextText: string,
): MentionTrigger | null {
  const change = findTextChange(previousText, nextText);
  return nextText.slice(change.start, change.nextEnd) === '@'
    ? { start: change.start, end: change.start + 1 }
    : null;
}

export function applyMentionTextChange(
  state: MentionDraftState,
  nextText: string,
): MentionDraftState {
  const change = findTextChange(state.text, nextText);
  const offset = change.nextEnd - change.previousEnd;
  const ranges = state.ranges.flatMap((range) => {
    if (range.end <= change.start) return [{ ...range }];
    if (range.start >= change.previousEnd) {
      return [{ ...range, start: range.start + offset, end: range.end + offset }];
    }
    return [];
  });

  return { text: nextText, ranges };
}

export function insertMentionSelection(
  state: MentionDraftState,
  trigger: MentionTrigger,
  selection: MentionSelection,
): { state: MentionDraftState; cursor: number } {
  const isValidTrigger =
    Number.isSafeInteger(trigger.start) &&
    Number.isSafeInteger(trigger.end) &&
    trigger.start >= 0 &&
    trigger.end === trigger.start + 1 &&
    trigger.end <= state.text.length &&
    state.text.slice(trigger.start, trigger.end) === '@';
  if (!isValidTrigger) return { state: { text: state.text, ranges: [...state.ranges] }, cursor: 0 };

  const effectiveRanges = state.ranges.filter((range) => isEffectiveRange(state.text, range));
  const existingUserIds = new Set(
    effectiveRanges.flatMap((range) => (isPositiveSafeInteger(range.userId) ? [range.userId] : [])),
  );
  const selectingAll = isMentionAllSelection(selection);
  const candidates = asCandidates(selection).filter(
    (candidate) =>
      isPositiveSafeInteger(candidate.userId) &&
      candidate.displayName.length > 0 &&
      !existingUserIds.has(candidate.userId),
  );
  const insertedText = selectingAll
    ? '@所有人 '
    : candidates.map((candidate) => `@${candidate.displayName} `).join('');
  const nextText =
    state.text.slice(0, trigger.start) + insertedText + state.text.slice(trigger.end);
  const changed = applyMentionTextChange(state, nextText);
  const retainedRanges = changed.ranges.filter((range) => {
    if (selectingAll) return range.mentionAll !== true && !isPositiveSafeInteger(range.userId);
    return range.mentionAll !== true;
  });
  const newRanges: MentionDraftRange[] = selectingAll
    ? [
        {
          mentionAll: true,
          displayName: '所有人',
          start: trigger.start,
          end: trigger.start + '@所有人'.length,
        },
      ]
    : candidates.reduce<MentionDraftRange[]>((ranges, candidate, index) => {
        const start =
          trigger.start +
          candidates.slice(0, index).reduce((length, item) => length + item.displayName.length + 2, 0);
        ranges.push({
          userId: candidate.userId,
          displayName: candidate.displayName,
          start,
          end: start + candidate.displayName.length + 1,
        });
        return ranges;
      }, []);

  return {
    state: { text: changed.text, ranges: [...retainedRanges, ...newRanges] },
    cursor: trigger.start + insertedText.length,
  };
}

export function toSendTextOptions(state: MentionDraftState): SendTextOptions {
  const ranges = state.ranges
    .filter((range) => isEffectiveRange(state.text, range))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (ranges.length === 0) return {};

  const mentionAll = ranges.some((range) => range.mentionAll === true);
  const protocolRanges = ranges
    .filter((range) => (mentionAll ? range.mentionAll === true : isPositiveSafeInteger(range.userId)))
    .reduce<TextMentionRange[]>((validRanges, range) => {
      const lastRange = validRanges[validRanges.length - 1];
      if (lastRange == null || lastRange.end <= range.start) validRanges.push(toTextMentionRange(range));
      return validRanges;
    }, []);
  if (protocolRanges.length === 0) return {};
  if (mentionAll) return { mentionAll: true, mentionRanges: protocolRanges };

  return {
    mentions: [...new Set(protocolRanges.map((range) => (range as { userId: number }).userId))],
    mentionRanges: protocolRanges,
  };
}
