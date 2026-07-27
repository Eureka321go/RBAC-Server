/** 单聊 cid：两个用户 id 升序拼接（对齐接口文档 §2.3）。 */
export function buildSingleCid(a: number, b: number): string {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return `c_${min}_${max}`;
}

/** 从 cid 反推会话类型与群 id；形态不认识时按单聊处理，不抛异常。 */
export function parseCid(cid: string): {
  type: 'SINGLE' | 'GROUP';
  groupId: number | null;
} {
  if (cid.startsWith('g_')) {
    const n = Number(cid.slice(2));
    return { type: 'GROUP', groupId: Number.isFinite(n) ? n : null };
  }
  return { type: 'SINGLE', groupId: null };
}
