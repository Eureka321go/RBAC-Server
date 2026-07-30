export function formatBytes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '未知大小';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function safeFilename(value: unknown): string {
  if (typeof value !== 'string') return '文件';
  const normalized = value.replace(/\\/g, '/');
  const leaf = normalized.slice(normalized.lastIndexOf('/') + 1)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return leaf || '文件';
}

export function displayableImageUri(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value.startsWith('/') ? `file://${value}` : value;
}
