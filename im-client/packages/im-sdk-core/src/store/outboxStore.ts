import type { Database, Row } from '../ports/index';
import type { StoredMessage } from './messageStore';

export type ChatStatus = 'sent' | 'sending' | 'acked' | 'failed';

/** 待确认消息：还没拿到服务端 seq，不能进 messages(cid, seq)。 */
export interface OutboxRow {
  clientMsgId: string;
  cid: string;
  type: string;
  body: Record<string, unknown> | null;
  status: ChatStatus;
  error: string | null;
  createdAt: number;
}

/** UI 统一视图：seq 为 null 即仍在 outbox。 */
export interface ChatMessage {
  cid: string;
  seq: number | null;
  clientMsgId: string | null;
  msgId: string | null;
  senderId: number | null;
  type: string;
  body: Record<string, unknown> | null;
  recalled: boolean;
  status: ChatStatus;
  error: string | null;
  ts: number;
}

function toRow(r: Row): OutboxRow {
  return {
    clientMsgId: r.client_msg_id as string,
    cid: r.cid as string,
    type: r.type as string,
    body: r.body_json == null ? null : (JSON.parse(r.body_json as string) as Record<string, unknown>),
    status: r.status as ChatStatus,
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as number,
  };
}

export class OutboxStore {
  constructor(private readonly db: Database) {}

  async insert(row: OutboxRow): Promise<void> {
    await this.db.exec(
      `INSERT INTO outbox (client_msg_id, cid, type, body_json, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.clientMsgId,
        row.cid,
        row.type,
        row.body === null ? null : JSON.stringify(row.body),
        row.status,
        row.error,
        row.createdAt,
      ],
    );
  }

  async get(clientMsgId: string): Promise<OutboxRow | null> {
    const rows = await this.db.query<Row>(
      `SELECT client_msg_id, cid, type, body_json, status, error, created_at
         FROM outbox WHERE client_msg_id = ?`,
      [clientMsgId],
    );
    return rows.length ? toRow(rows[0]) : null;
  }

  async listByCid(cid: string): Promise<OutboxRow[]> {
    const rows = await this.db.query<Row>(
      `SELECT client_msg_id, cid, type, body_json, status, error, created_at
         FROM outbox WHERE cid = ? ORDER BY created_at ASC`,
      [cid],
    );
    return rows.map(toRow);
  }

  async setStatus(clientMsgId: string, status: ChatStatus, error: string | null): Promise<void> {
    await this.db.exec(`UPDATE outbox SET status = ?, error = ? WHERE client_msg_id = ?`, [
      status,
      error,
      clientMsgId,
    ]);
  }

  /** 条件更新：只有当前状态等于 from 才改。天然处理 ACK/超时/PUSH 三者的到达竞争。 */
  async setStatusWhere(
    clientMsgId: string,
    from: ChatStatus,
    to: ChatStatus,
    error: string | null,
  ): Promise<void> {
    await this.db.exec(
      `UPDATE outbox SET status = ?, error = ? WHERE client_msg_id = ? AND status = ?`,
      [to, error, clientMsgId, from],
    );
  }

  async delete(clientMsgId: string): Promise<void> {
    await this.db.exec(`DELETE FROM outbox WHERE client_msg_id = ?`, [clientMsgId]);
  }
}

/** 已落库与待发消息统一按时间升序，避免历史失败消息被固定排到最新消息之后。 */
export function mergeChatMessages(
  messages: StoredMessage[],
  pending: OutboxRow[],
): ChatMessage[] {
  const persisted: ChatMessage[] = messages.map((m) => ({
    cid: m.cid,
    seq: m.seq,
    clientMsgId: m.clientMsgId,
    msgId: m.msgId,
    senderId: m.senderId,
    type: m.type,
    body: m.body,
    recalled: m.recalled,
    status: 'sent',
    error: null,
    ts: m.ts,
  }));
  const waiting: ChatMessage[] = pending.map((p) => ({
    cid: p.cid,
    seq: null,
    clientMsgId: p.clientMsgId,
    msgId: null,
    senderId: null, // 待发消息必然是本机发的，UI 按 seq == null 判己方
    type: p.type,
    body: p.body,
    recalled: false,
    status: p.status,
    error: p.error,
    ts: p.createdAt,
  }));
  return [...persisted, ...waiting].sort((a, b) => a.ts - b.ts);
}
