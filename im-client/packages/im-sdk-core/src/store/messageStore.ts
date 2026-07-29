import type { Database, Row } from '../ports/index';
import { parseCid } from '../protocol/cid';

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
  peerId: number | null;
  peerName: string | null;
  displayName: string | null;
  lastMsgSeq: number;
  lastMsgPreview: string | null;
  lastReadSeq: number;
  unreadCount: number;
  mentionSeq: number;
  hasMention: boolean;
  peerReadSeq: number | null;
  updatedAt: number;
}

export interface ConversationReadState {
  lastReadSeq: number;
  peerReadSeq: number | null;
}

export class MessageStore {
  constructor(private readonly db: Database) {}

  /**
   * 本地库暂未按 userId 分文件；检测到账号切换时清空上一账号缓存，防止跨账号展示私聊内容。
   * 同一账号重复登录不会清数据，杀进程/登出重登仍保留离线历史。
   */
  async activateAccount(userId: number): Promise<void> {
    const accountKey = '__account__';
    await this.db.tx(async (tx) => {
      const rows = await tx.query<Row>(
        `SELECT synced_seq FROM sync_meta WHERE cid = ?`,
        [accountKey],
      );
      if (rows.length > 0 && rows[0].synced_seq === userId) return;

      await tx.exec(`DELETE FROM outbox`);
      await tx.exec(`DELETE FROM messages`);
      await tx.exec(`DELETE FROM conversations`);
      await tx.exec(`DELETE FROM voice_heard`);
      await tx.exec(`DELETE FROM sync_meta`);
      await tx.exec(`INSERT INTO sync_meta (cid, synced_seq) VALUES (?, ?)`, [accountKey, userId]);
    });
  }

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
        m.recalled || m.body === null ? null : JSON.stringify(m.body),
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

  /** 撤回目标只保留占位元数据；正文必须与 recalled 标记在同一条 UPDATE 中清除。 */
  async markMessageRecalled(cid: string, targetSeq: number): Promise<void> {
    await this.db.exec(
      `UPDATE messages
          SET recalled = 1, body_json = NULL
        WHERE cid = ? AND seq = ?`,
      [cid, targetSeq],
    );
  }

  /**
   * 查找某条消息对应的撤回操作者。
   * 不依赖 SQLite JSON 扩展，保持 SDK Core 对不同数据库适配器的兼容性。
   */
  async findRecallOperatorId(cid: string, targetSeq: number): Promise<number | null> {
    const rows = await this.db.query<Row>(
      `SELECT sender_id, body_json
         FROM messages
        WHERE cid = ? AND type = 'RECALL'
        ORDER BY seq DESC`,
      [cid],
    );
    for (const row of rows) {
      if (row.body_json == null) continue;
      try {
        const body = JSON.parse(row.body_json as string) as Record<string, unknown>;
        if (body.targetSeq === targetSeq) {
          return (row.sender_id as number | null) ?? null;
        }
      } catch {
        // 单条损坏的控制消息不能阻断后续同步。
      }
    }
    return null;
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
         (cid, type, group_id, peer_id, peer_name, display_name, last_msg_seq,
          last_msg_preview, last_read_seq, peer_read_seq, mention_seq, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid) DO UPDATE SET
         type = excluded.type,
         group_id = excluded.group_id,
         peer_id = excluded.peer_id,
         peer_name = excluded.peer_name,
         display_name = CASE
           WHEN excluded.display_name IS NULL OR excluded.display_name = ''
           THEN conversations.display_name ELSE excluded.display_name END,
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
        c.peerId,
        c.peerName,
        c.displayName,
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
      `SELECT cid, type, group_id, peer_id, peer_name, display_name, last_msg_seq,
              last_msg_preview, last_read_seq, peer_read_seq, mention_seq, updated_at
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
        peerId: (r.peer_id as number | null) ?? null,
        peerName: (r.peer_name as string | null) ?? null,
        displayName: (r.display_name as string | null) ?? null,
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

  async setConversationDisplayName(cid: string, name: string): Promise<void> {
    const normalized = name.trim();
    if (normalized === '') return;
    await this.db.exec(
      `UPDATE conversations SET display_name = ?, updated_at = MAX(updated_at, ?) WHERE cid = ?`,
      [normalized, Date.now(), cid],
    );
  }

  /** 退出或解散群聊后只清理目标 cid；重复调用保持幂等。 */
  async removeConversation(cid: string): Promise<void> {
    await this.db.tx(async (tx) => {
      await tx.exec(`DELETE FROM outbox WHERE cid = ?`, [cid]);
      await tx.exec(`DELETE FROM messages WHERE cid = ?`, [cid]);
      await tx.exec(`DELETE FROM conversations WHERE cid = ?`, [cid]);
      await tx.exec(`DELETE FROM sync_meta WHERE cid = ?`, [cid]);
    });
  }

  async getConversationReadState(cid: string): Promise<ConversationReadState> {
    const rows = await this.db.query<Row>(
      `SELECT last_read_seq, peer_read_seq FROM conversations WHERE cid = ?`,
      [cid],
    );
    if (rows.length === 0) {
      return { lastReadSeq: 0, peerReadSeq: null };
    }
    return {
      lastReadSeq: rows[0].last_read_seq as number,
      peerReadSeq: (rows[0].peer_read_seq as number | null) ?? null,
    };
  }

  /** 当前账号自己的阅读位点，只允许前向推进。 */
  async advanceReadSeq(cid: string, readSeq: number): Promise<void> {
    await this.db.exec(
      `UPDATE conversations
          SET last_read_seq = MAX(last_read_seq, ?)
        WHERE cid = ?`,
      [readSeq, cid],
    );
  }

  /** 单聊对端的阅读位点，只允许前向推进；READ 帧与 REST 快照不会互相回退。 */
  async advancePeerReadSeq(cid: string, readSeq: number): Promise<void> {
    const { type, groupId } = parseCid(cid);
    await this.db.exec(
      `INSERT INTO conversations (cid, type, group_id, peer_read_seq, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cid) DO UPDATE SET
         peer_read_seq = CASE
            WHEN peer_read_seq IS NULL THEN ?
            ELSE MAX(peer_read_seq, ?) END`,
      [cid, type, groupId, readSeq, Date.now(), readSeq, readSeq],
    );
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
