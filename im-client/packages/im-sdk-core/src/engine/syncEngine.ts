import type { Emitter } from '../events/emitter';
import { MessageStore, type StoredMessage } from '../store/messageStore';
import { OutboxStore } from '../store/outboxStore';
import { parseCid } from '../protocol/cid';
import type { Envelope } from '../protocol/types';
import type { Database } from '../ports/index';

export interface SdkEvents extends Record<string, unknown> {
  message: { cid: string };
  conversation: { cid: string };
  sendError: { cid: string; clientMsgId: string; reason: string };
  syncState: { running: boolean; error: string | null };
}

export interface RestMessage {
  cid: string;
  seq: number;
  msgId: string;
  senderId: number;
  type: string;
  body: Record<string, unknown> | null;
  recalled: boolean;
  ts: number;
}

/** 会话列表用的一行摘要文案；正文过长时截断。 */
export function previewOf(type: string | undefined, body: Record<string, unknown> | null): string {
  switch (type) {
    case 'TEXT':
    case 'SYSTEM': {
      const text = typeof body?.text === 'string' ? body.text : '';
      return text.length > 50 ? `${text.slice(0, 50)}…` : text;
    }
    case 'IMAGE':
      return '[图片]';
    case 'AUDIO':
      return '[语音]';
    case 'FILE':
      return '[文件]';
    case 'RECALL':
      return '[消息已撤回]';
    default:
      return '';
  }
}

/**
 * 同步引擎：SQLite 单一事实源的写入口。
 * WS PUSH 与（M3 的）REST 拉取都归到 applyPush 这一条路径，保证去重/位点语义只有一份。
 */
export class SyncEngine {
  private readonly store: MessageStore;

  constructor(
    private readonly db: Database,
    private readonly emitter: Emitter<SdkEvents>,
  ) {
    this.store = new MessageStore(db);
  }

  async applyIncoming(m: StoredMessage): Promise<void> {
    await this.store.upsertMessage(m);
    this.emitter.emit('message', { cid: m.cid });
    this.emitter.emit('conversation', { cid: m.cid });
  }

  /** 落库 + 发送对账 + 位点推进，全部在一个事务内；脏帧直接丢弃不炸线程。 */
  async applyPush(env: Envelope): Promise<void> {
    const cid = env.cid;
    const seq = env.seq;
    if (typeof cid !== 'string' || cid === '') return;
    if (typeof seq !== 'number' || !Number.isFinite(seq)) return;

    const body = (env.body ?? null) as Record<string, unknown> | null;
    const stored: StoredMessage = {
      cid,
      seq,
      msgId: env.msgId ?? null,
      clientMsgId: env.clientMsgId ?? null,
      senderId: env.senderId ?? null,
      type: env.type ?? 'TEXT',
      body,
      recalled: false,
      status: 'sent',
      ts: env.ts ?? 0,
    };

    await this.applyStored(stored);
  }

  /** REST 增量消息复用 WS PUSH 的同一事务写路径，并保留服务端撤回状态。 */
  async applyRestMessage(message: RestMessage): Promise<void> {
    if (message.cid === '') return;
    if (!Number.isFinite(message.seq)) return;
    await this.applyStored({
      cid: message.cid,
      seq: message.seq,
      msgId: message.msgId,
      clientMsgId: null,
      senderId: message.senderId,
      type: message.type,
      body: message.body,
      recalled: message.recalled,
      status: 'sent',
      ts: message.ts,
    });
  }

  private async applyStored(stored: StoredMessage): Promise<void> {
    const { cid } = stored;
    const { type, groupId } = parseCid(cid);

    await this.db.tx(async (tx) => {
      const messages = new MessageStore(tx);
      await messages.upsertMessage(stored);
      if (stored.clientMsgId) {
        await new OutboxStore(tx).delete(stored.clientMsgId);
      }
      await messages.advanceConversation({
        cid,
        type,
        groupId,
        seq: stored.seq,
        preview: previewOf(stored.type, stored.body),
      });
      await messages.advanceSyncedSeq(cid, stored.seq);
    });

    this.emitter.emit('message', { cid });
    this.emitter.emit('conversation', { cid });
  }
}
