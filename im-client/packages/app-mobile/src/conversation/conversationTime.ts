const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function localDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 会话列表时间：今天显示时分，最近日期使用微信式相对日期。 */
export function formatConversationTime(timestamp: number, now = new Date()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || Number.isNaN(now.getTime())) return '';
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const dayDiff = localDayNumber(now) - localDayNumber(date);
  if (dayDiff === 0) return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (dayDiff === 1) return '昨天';
  if (dayDiff >= 2 && dayDiff <= 6) return WEEKDAYS[date.getDay()];
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
