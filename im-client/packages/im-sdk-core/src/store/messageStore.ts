import type { Database, Row } from '../ports/index';

export interface StoredMessage {
  cid: string;
  seq: number;
  msgId: string | null;
  clientMsgId: string | null;
  senderId: number | null;
  type: string;
  body: Record<string, unknown> | null;
  recalled: boolean;
  status: string;
  ts: number;
}

export interface ConversationRow {
  cid: string;
  type: 'SINGLE' | 'GROUP';
  groupId: number | null;
  lastMsgSeq: number;
  lastMsgPreview: string | null;
  lastReadSeq: number;
  unreadCount: number;
  mentionSeq: number;
  hasMention: boolean;
  peerReadSeq: number | null;
  updatedAt: number;
}

export class MessageStore {
  constructor(private readonly db: Database) {}

  async upsertMessage(m: StoredMessage): Promise<void> {
    await this.db.exec(
      `INSERT INTO messages
         (cid, seq, msg_id, client_msg_id, sender_id, type, body_json, recalled, status, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid, seq) DO UPDATE SET
         msg_id=excluded.msg_id,
         client_msg_id=excluded.client_msg_id,
         sender_id=excluded.sender_id,
         type=excluded.type,
         body_json=excluded.body_json,
         recalled=excluded.recalled,
         status=excluded.status,
         ts=excluded.ts`,
      [
        m.cid,
        m.seq,
        m.msgId,
        m.clientMsgId,
        m.senderId,
        m.type,
        m.body === null ? null : JSON.stringify(m.body),
        m.recalled ? 1 : 0,
        m.status,
        m.ts,
      ],
    );
  }

  async getMessages(cid: string): Promise<StoredMessage[]> {
    const rows = await this.db.query<Row>(
      `SELECT cid, seq, msg_id, client_msg_id, sender_id, type, body_json, recalled, status, ts
         FROM messages WHERE cid = ? ORDER BY seq ASC`,
      [cid],
    );
    return rows.map((r) => ({
      cid: r.cid as string,
      seq: r.seq as number,
      msgId: (r.msg_id as string | null) ?? null,
      clientMsgId: (r.client_msg_id as string | null) ?? null,
      senderId: (r.sender_id as number | null) ?? null,
      type: r.type as string,
      body: r.body_json == null ? null : (JSON.parse(r.body_json as string) as Record<string, unknown>),
      recalled: (r.recalled as number) === 1,
      status: r.status as string,
      ts: r.ts as number,
    }));
  }

  async upsertConversation(c: {
    cid: string;
    type: string;
    groupId: number | null;
    lastMsgSeq: number;
    lastMsgPreview: string | null;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO conversations (cid, type, group_id, last_msg_seq, last_msg_preview, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid) DO UPDATE SET
         type=excluded.type,
         group_id=excluded.group_id,
         last_msg_seq=excluded.last_msg_seq,
         last_msg_preview=excluded.last_msg_preview,
         updated_at=excluded.updated_at`,
      [c.cid, c.type, c.groupId, c.lastMsgSeq, c.lastMsgPreview, Date.now()],
    );
  }

  async getConversations(): Promise<
    Array<{ cid: string; type: string; lastMsgSeq: number }>
  > {
    const rows = await this.db.query<Row>(
      `SELECT cid, type, last_msg_seq FROM conversations ORDER BY updated_at DESC`,
    );
    return rows.map((r) => ({
      cid: r.cid as string,
      type: r.type as string,
      lastMsgSeq: r.last_msg_seq as number,
    }));
  }

  /** 服务端会话快照写入本地；与并发 PUSH 冲突时所有 seq 位点只向前推进。 */
  async upsertConversationSnapshot(c: ConversationRow): Promise<void> {
    await this.db.exec(
      `INSERT INTO conversations
         (cid, type, group_id, last_msg_seq, last_msg_preview, last_read_seq,
          peer_read_seq, mention_seq, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid) DO UPDATE SET
         type = excluded.type,
         group_id = excluded.group_id,
         last_msg_preview = CASE
           WHEN excluded.last_msg_seq >= conversations.last_msg_seq
           THEN excluded.last_msg_preview ELSE conversations.last_msg_preview END,
         last_msg_seq = MAX(conversations.last_msg_seq, excluded.last_msg_seq),
         last_read_seq = MAX(conversations.last_read_seq, excluded.last_read_seq),
         peer_read_seq = CASE
           WHEN excluded.peer_read_seq IS NULL THEN conversations.peer_read_seq
           WHEN conversations.peer_read_seq IS NULL THEN excluded.peer_read_seq
           ELSE MAX(conversations.peer_read_seq, excluded.peer_read_seq) END,
         mention_seq = MAX(conversations.mention_seq, excluded.mention_seq),
         updated_at = MAX(conversations.updated_at, excluded.updated_at)`,
      [
        c.cid,
        c.type,
        c.groupId,
        c.lastMsgSeq,
        c.lastMsgPreview,
        c.lastReadSeq,
        c.peerReadSeq,
        c.mentionSeq,
        c.updatedAt,
      ],
    );
  }

  /** UI 只读 SQLite；未读与 @ 状态从已经前向合并的本地位点实时派生。 */
  async getConversationRows(): Promise<ConversationRow[]> {
    const rows = await this.db.query<Row>(
      `SELECT cid, type, group_id, last_msg_seq, last_msg_preview, last_read_seq,
              peer_read_seq, mention_seq, updated_at
         FROM conversations ORDER BY updated_at DESC`,
    );
    return rows.map((r) => {
      const lastMsgSeq = r.last_msg_seq as number;
      const lastReadSeq = r.last_read_seq as number;
      const mentionSeq = r.mention_seq as number;
      return {
        cid: r.cid as string,
        type: r.type as 'SINGLE' | 'GROUP',
        groupId: (r.group_id as number | null) ?? null,
        lastMsgSeq,
        lastMsgPreview: (r.last_msg_preview as string | null) ?? null,
        lastReadSeq,
        unreadCount: Math.max(0, lastMsgSeq - lastReadSeq),
        mentionSeq,
        hasMention: mentionSeq > lastReadSeq,
        peerReadSeq: (r.peer_read_seq as number | null) ?? null,
        updatedAt: r.updated_at as number,
      };
    });
  }

  async getSyncedSeq(cid: string): Promise<number> {
    const rows = await this.db.query<Row>(
      `SELECT synced_seq FROM sync_meta WHERE cid = ?`,
      [cid],
    );
    return rows.length ? (rows[0].synced_seq as number) : 0;
  }

  async setSyncedSeq(cid: string, seq: number): Promise<void> {
    await this.db.exec(
      `INSERT INTO sync_meta (cid, synced_seq) VALUES (?, ?)
       ON CONFLICT(cid) DO UPDATE SET synced_seq=excluded.synced_seq`,
      [cid, seq],
    );
  }

  /** 会话位点只增不减；预览仅在 seq 更大时才更新，乱序到达的旧消息不得覆盖。 */
  async advanceConversation(c: {
    cid: string;
    type: string;
    groupId: number | null;
    seq: number;
    preview: string | null;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO conversations (cid, type, group_id, last_msg_seq, last_msg_preview, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid) DO UPDATE SET
         last_msg_preview = CASE WHEN excluded.last_msg_seq > conversations.last_msg_seq
                                 THEN excluded.last_msg_preview
                                 ELSE conversations.last_msg_preview END,
         last_msg_seq = MAX(conversations.last_msg_seq, excluded.last_msg_seq),
         updated_at = CASE WHEN excluded.last_msg_seq >= conversations.last_msg_seq
                           THEN excluded.updated_at ELSE conversations.updated_at END`,
      [c.cid, c.type, c.groupId, c.seq, c.preview, Date.now()],
    );
  }

  /** 同步位点前向单调推进（M3 增量拉取的起点）。 */
  async advanceSyncedSeq(cid: string, seq: number): Promise<void> {
    await this.db.exec(
      `INSERT INTO sync_meta (cid, synced_seq) VALUES (?, ?)
       ON CONFLICT(cid) DO UPDATE SET synced_seq = MAX(sync_meta.synced_seq, excluded.synced_seq)`,
      [cid, seq],
    );
  }
}
