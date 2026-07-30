import type { Emitter } from '../events/emitter';
import { MessageStore, type StoredMessage } from '../store/messageStore';
import { OutboxStore } from '../store/outboxStore';
import { parseCid } from '../protocol/cid';
import type { Envelope } from '../protocol/types';
import type { Database } from '../ports/index';
import {
  normalizeLinkCard,
  normalizeTextMessageBody,
  type LinkCard,
} from '../chat/linkCard';

interface PendingLinkPreview {
  link: LinkCard;
  expiresAt: number;
}

export type RecallResultStatus = 'succeeded' | 'failed' | 'timeout';

export interface SdkEvents extends Record<string, unknown> {
  message: { cid: string; type?: string };
  conversation: { cid: string };
  readReceipt: { cid: string; readSeq: number };
  recallResult: {
    cid: string;
    targetSeq: number;
    status: RecallResultStatus;
    reason?: string;
  };
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
    case 'TEXT': {
      const text = typeof body?.text === 'string' ? body.text : '';
      return text.length > 50 ? `${text.slice(0, 50)}…` : text;
    }
    case 'SYSTEM':
      return '[群聊信息]';
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
  private static readonly MAX_PENDING_LINK_PREVIEWS = 100;
  private static readonly PENDING_LINK_PREVIEW_TTL_MS = 60_000;
  private readonly store: MessageStore;
  private readonly pendingLinkPreviews = new Map<string, PendingLinkPreview>();
  private clientMessageSettled: ((clientMsgId: string) => Promise<void>) | null = null;

  constructor(
    private readonly db: Database,
    private readonly emitter: Emitter<SdkEvents>,
  ) {
    this.store = new MessageStore(db);
  }

  onClientMessageSettled(handler: (clientMsgId: string) => Promise<void>): void {
    this.clientMessageSettled = handler;
  }

  async applyIncoming(m: StoredMessage): Promise<void> {
    await this.store.upsertMessage(m);
    this.emitter.emit('message', { cid: m.cid, type: m.type });
    this.emitter.emit('conversation', { cid: m.cid });
  }

  /** 落库 + 发送对账 + 位点推进，全部在一个事务内；脏帧直接丢弃不炸线程。 */
  async applyPush(env: Envelope): Promise<void> {
    const cid = env.cid;
    const seq = env.seq;
    if (typeof cid !== 'string' || cid === '') return;
    if (typeof seq !== 'number' || !Number.isFinite(seq)) return;

    const type = env.type ?? 'TEXT';
    const body = this.normalizeBody(type, env.body ?? null);
    const stored: StoredMessage = {
      cid,
      seq,
      msgId: env.msgId ?? null,
      clientMsgId: env.clientMsgId ?? null,
      senderId: env.senderId ?? null,
      type,
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
      body: this.normalizeBody(message.type, message.body),
      recalled: message.recalled,
      status: 'sent',
      ts: message.ts,
    });
  }

  async applyLinkPreview(env: Envelope): Promise<void> {
    const cid = env.cid;
    const seq = env.seq;
    const link = normalizeLinkCard(env.body?.link);
    if (typeof cid !== 'string' || cid === '') return;
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= 0) return;
    if (link == null) return;

    const result = await this.store.mergeLinkPreview(cid, seq, link);
    if (result === 'updated') {
      this.emitter.emit('message', { cid, type: 'TEXT' });
    } else if (result === 'missing') {
      this.savePendingLinkPreview(cid, seq, link);
    }
  }

  clearPendingLinkPreviews(): void {
    this.pendingLinkPreviews.clear();
  }

  private async applyStored(stored: StoredMessage): Promise<void> {
    const pendingLink = this.takePendingLinkPreview(stored.cid, stored.seq);
    const body = stored.body;
    const message = pendingLink != null
      && stored.type === 'TEXT'
      && !stored.recalled
      && body != null
      && !Array.isArray(body)
      ? { ...stored, body: { ...body, link: pendingLink } }
      : stored;
    const { cid } = message;
    const { type, groupId } = parseCid(cid);

    await this.db.tx(async (tx) => {
      const messages = new MessageStore(tx);
      await messages.upsertMessage(message);
      const targetSeq = message.type === 'RECALL'
        && typeof message.body?.targetSeq === 'number'
        && Number.isSafeInteger(message.body.targetSeq)
        && message.body.targetSeq > 0
        ? message.body.targetSeq
        : null;
      if (targetSeq != null) {
        await messages.markMessageRecalled(cid, targetSeq);
      } else if (message.type !== 'RECALL' && !message.recalled) {
        const recallOperatorId = await messages.findRecallOperatorId(cid, message.seq);
        if (recallOperatorId != null) {
          await messages.markMessageRecalled(cid, message.seq);
        }
      }
      if (message.clientMsgId) {
        await new OutboxStore(tx).delete(message.clientMsgId);
      }
      await messages.advanceConversation({
        cid,
        type,
        groupId,
        seq: message.seq,
        preview: previewOf(message.type, message.body),
        ts: message.ts,
      });
      await messages.advanceSyncedSeq(cid, message.seq);
    });

    this.emitter.emit('message', { cid, type: message.type });
    this.emitter.emit('conversation', { cid });
    if (message.clientMsgId != null && this.clientMessageSettled != null) {
      await this.clientMessageSettled(message.clientMsgId).catch(() => {});
    }
  }

  private normalizeBody(
    type: string,
    body: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    return type === 'TEXT' ? normalizeTextMessageBody(body) : body;
  }

  private linkPreviewKey(cid: string, seq: number): string {
    return `${cid}\u0000${seq}`;
  }

  private prunePendingLinkPreviews(now: number): void {
    this.pendingLinkPreviews.forEach((entry, key) => {
      if (entry.expiresAt <= now) this.pendingLinkPreviews.delete(key);
    });
  }

  private savePendingLinkPreview(cid: string, seq: number, link: LinkCard): void {
    const now = Date.now();
    this.prunePendingLinkPreviews(now);
    const key = this.linkPreviewKey(cid, seq);
    this.pendingLinkPreviews.delete(key);
    if (this.pendingLinkPreviews.size >= SyncEngine.MAX_PENDING_LINK_PREVIEWS) {
      const oldestKey = this.pendingLinkPreviews.keys().next().value;
      if (typeof oldestKey === 'string') this.pendingLinkPreviews.delete(oldestKey);
    }
    this.pendingLinkPreviews.set(key, {
      link,
      expiresAt: now + SyncEngine.PENDING_LINK_PREVIEW_TTL_MS,
    });
  }

  private takePendingLinkPreview(cid: string, seq: number): LinkCard | null {
    const key = this.linkPreviewKey(cid, seq);
    const pending = this.pendingLinkPreviews.get(key);
    this.pendingLinkPreviews.delete(key);
    return pending != null && pending.expiresAt > Date.now() ? pending.link : null;
  }
}
