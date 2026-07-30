import { normalizeMessageQuote } from './quotePayload';

export interface LinkCard {
  url: string;
  title: string;
  description?: string;
  siteName?: string;
}

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_SITE_NAME_LENGTH = 200;

interface ParsedUrl {
  protocol: string;
  hostname: string;
  toString(): string;
}

type UrlConstructor = new (value: string) => ParsedUrl;

function parseUrl(value: string): ParsedUrl | null {
  const Url = (globalThis as unknown as { URL?: UrlConstructor }).URL;
  if (Url == null) return null;
  try {
    return new Url(value);
  } catch {
    return null;
  }
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized === '') return undefined;
  return normalized.slice(0, maxLength);
}

export function normalizeLinkCard(value: unknown): LinkCard | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== 'string' || raw.url.length > MAX_URL_LENGTH) return null;
  const parsed = parseUrl(raw.url);
  if (parsed == null || parsed.hostname === '') return null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const title = optionalText(raw.title, MAX_TITLE_LENGTH);
  if (title == null) return null;
  const description = optionalText(raw.description, MAX_DESCRIPTION_LENGTH);
  const siteName = optionalText(raw.siteName, MAX_SITE_NAME_LENGTH);
  return {
    url: parsed.toString(),
    title,
    ...(description == null ? {} : { description }),
    ...(siteName == null ? {} : { siteName }),
  };
}

export function normalizeTextMessageBody(
  body: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (body == null) return null;
  const hasLink = Object.prototype.hasOwnProperty.call(body, 'link');
  const hasQuote = Object.prototype.hasOwnProperty.call(body, 'quote');
  if (!hasLink && !hasQuote) return body;
  const { link: rawLink, quote: rawQuote, ...rest } = body;
  const link = hasLink ? normalizeLinkCard(rawLink) : null;
  const quote = hasQuote ? normalizeMessageQuote(rawQuote) : null;
  return {
    ...rest,
    ...(link == null ? {} : { link }),
    ...(quote == null ? {} : { quote }),
  };
}
