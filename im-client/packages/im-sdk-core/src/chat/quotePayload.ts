import type { ChatMessage } from '../store/outboxStore';

export type QuotedMessageType = 'TEXT' | 'IMAGE' | 'FILE' | 'AUDIO';

export interface MessageQuote {
  targetSeq: number;
  senderId: number;
  senderName: string;
  type: QuotedMessageType;
  summary: string;
}

const SUPPORTED_TYPES = new Set<QuotedMessageType>(['TEXT', 'IMAGE', 'FILE', 'AUDIO']);
const MAX_SENDER_NAME_CODE_POINTS = 80;
const MAX_SUMMARY_CODE_POINTS = 120;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isQuotedMessageType(value: unknown): value is QuotedMessageType {
  return typeof value === 'string' && SUPPORTED_TYPES.has(value as QuotedMessageType);
}

function normalizeRequiredText(value: unknown, maxCodePoints: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/\p{C}+/gu, ' ')
    .replace(/[\p{Z}\s]+/gu, ' ')
    .trim();
  if (normalized === '') return null;
  return Array.from(normalized).slice(0, maxCodePoints).join('');
}

function basename(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function summaryForMessage(message: ChatMessage): string {
  switch (message.type) {
    case 'TEXT':
      return normalizeRequiredText(message.body?.text, MAX_SUMMARY_CODE_POINTS) ?? '[文本]';
    case 'IMAGE':
      return '[图片]';
    case 'FILE':
      return normalizeRequiredText(basename(message.body?.filename), MAX_SUMMARY_CODE_POINTS)
        ?? '[文件]';
    case 'AUDIO':
      return '[语音]';
    default:
      return '[消息]';
  }
}

export function normalizeMessageQuote(value: unknown): MessageQuote | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isPositiveSafeInteger(raw.targetSeq) || !isPositiveSafeInteger(raw.senderId)) return null;
  if (!isQuotedMessageType(raw.type)) return null;
  const senderName = normalizeRequiredText(raw.senderName, MAX_SENDER_NAME_CODE_POINTS);
  const summary = normalizeRequiredText(raw.summary, MAX_SUMMARY_CODE_POINTS);
  if (senderName == null || summary == null) return null;
  return {
    targetSeq: raw.targetSeq,
    senderId: raw.senderId,
    senderName,
    type: raw.type,
    summary,
  };
}

export function canQuoteMessage(message: ChatMessage): boolean {
  return message.seq != null
    && message.status === 'sent'
    && !message.recalled
    && isQuotedMessageType(message.type);
}

export function buildMessageQuote(
  message: ChatMessage,
  senderName: string,
): MessageQuote | null {
  if (!canQuoteMessage(message) || message.seq == null || message.senderId == null) return null;
  return normalizeMessageQuote({
    targetSeq: message.seq,
    senderId: message.senderId,
    senderName,
    type: message.type,
    summary: summaryForMessage(message),
  });
}
