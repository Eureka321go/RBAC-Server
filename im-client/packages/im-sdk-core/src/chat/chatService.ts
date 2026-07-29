import type { Emitter } from '../events/emitter';
import type { ConnectionManager } from '../connection/connectionManager';
import type { SdkEvents, SyncEngine } from '../engine/syncEngine';
import type { ConversationReadState, MessageStore } from '../store/messageStore';
import {
  mergeChatMessages,
  type ChatMessage,
  type OutboxRow,
  type OutboxStore,
} from '../store/outboxStore';
import { OP, type Envelope, type MessageType } from '../protocol/types';
import type { Ids } from '../ports/index';
import { buildTextMessageBody, type SendTextOptions } from './mentionPayload';
import type { MediaUploadStore } from '../media/mediaUploadStore';
import { mediaTaskToChatMessage } from '../media/mediaTypes';

export interface ChatOptions {
  /** 发出 SEND 后多久没收到 ACK 就判失败（毫秒） */
  ackTimeoutMs?: number;
  /** 收到 ACK 后多久没收到最终 PUSH 就判失败（毫秒） */
  pushTimeoutMs?: number;
  /** 发出 RECALL 后多久没收到 PUSH/ERROR 就释放等待（毫秒） */
  recallTimeoutMs?: number;
}

const DEFAULT_ACK_TIMEOUT_MS = 15000;
const DEFAULT_PUSH_TIMEOUT_MS = 30000;
const DEFAULT_RECALL_TIMEOUT_MS = 10000;

interface PendingRecall {
  targetSeq: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 发送编排 + 下行帧路由。
 * 发送即以 clientMsgId 乐观写 outbox；ACK 表示网关受理；自己的 PUSH 到达才算最终落定。
 */
export class ChatService {
  private readonly ackTimeoutMs: number;
  private readonly pushTimeoutMs: number;
  private readonly recallTimeoutMs: number;
  private readonly ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingRecalls = new Map<string, PendingRecall>();
  private readonly offs: Array<() => void> = [];
  // 下行帧串行链：RN 的原生事件桥会在同一 JS turn 批量投递多帧，
  // fire-and-forget 会让第二帧在第一帧的 db.tx 未提交时插入，
  // 撞穿 sql.js「事务内再开事务」的边界。所有帧按到达顺序排队执行。
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly connection: ConnectionManager,
    private readonly engine: SyncEngine,
    private readonly messages: MessageStore,
    private readonly outbox: OutboxStore,
    private readonly ids: Ids,
    private readonly emitter: Emitter<SdkEvents>,
    opts: ChatOptions = {},
    private readonly mediaUploads?: MediaUploadStore,
    private readonly getAccountId: () => number | null = () => null,
  ) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.pushTimeoutMs = opts.pushTimeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS;
    this.recallTimeoutMs = opts.recallTimeoutMs ?? DEFAULT_RECALL_TIMEOUT_MS;
    this.offs.push(
      this.connection.on('ack', ({ clientMsgId }) => this.enqueue(() => this.onAck(clientMsgId))),
      this.connection.on('envelope', (env) => this.enqueue(() => this.onEnvelope(env))),
    );
  }

  /** 单帧处理失败不阻断后续帧；同时把所有 DB 异常收口，避免变成 unhandledRejection。 */
  private enqueue(job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch(() => {
      /* 忽略：单帧异常已在各 handler 内部妥善处理或本就可丢弃 */
    });
  }

  on<K extends keyof SdkEvents>(key: K, fn: (payload: SdkEvents[K]) => void): () => void {
    return this.emitter.on(key, fn);
  }

  /** 返回 clientMsgId，供 UI 关联气泡与重发。 */
  async sendText(cid: string, text: string, options: SendTextOptions = {}): Promise<string> {
    const row: OutboxRow = {
      clientMsgId: this.ids.uuid(),
      cid,
      type: 'TEXT',
      body: buildTextMessageBody(text, options),
      status: 'sending',
      error: null,
      createdAt: this.ids.now(),
    };
    await this.outbox.insert(row);
    this.emitter.emit('message', { cid });
    await this.dispatch(row);
    return row.clientMsgId;
  }

  /** 对象已经上传完成后进入与文本完全相同的 outbox ACK/PUSH 结算链路。 */
  async sendMedia(
    cid: string,
    type: 'IMAGE' | 'FILE',
    body: Record<string, unknown>,
    clientMsgId = this.ids.uuid(),
  ): Promise<string> {
    if (typeof body.objectKey !== 'string' || body.objectKey === '') {
      throw new Error('UPLOAD_OBJECT_MISSING');
    }
    const existing = await this.outbox.get(clientMsgId);
    if (existing != null) {
      await this.outbox.setStatus(clientMsgId, 'sending', null);
      await this.dispatch({ ...existing, status: 'sending', error: null });
      this.emitter.emit('message', { cid: existing.cid });
      return clientMsgId;
    }
    const row: OutboxRow = {
      clientMsgId,
      cid,
      type,
      body,
      status: 'sending',
      error: null,
      createdAt: this.ids.now(),
    };
    await this.outbox.insert(row);
    this.emitter.emit('message', { cid });
    await this.dispatch(row);
    return clientMsgId;
  }

  /** 复用同一 clientMsgId 重发；服务端对 clientMsgId 幂等，不会产生重复消息。 */
  async resend(clientMsgId: string): Promise<void> {
    const row = await this.outbox.get(clientMsgId);
    if (row == null) return;
    await this.outbox.setStatus(clientMsgId, 'sending', null);
    this.emitter.emit('message', { cid: row.cid });
    await this.dispatch({ ...row, status: 'sending', error: null });
  }

  /** 撤回由服务端 PUSH/ERROR 最终确认；同一会话同时只允许一个待确认请求。 */
  async recall(cid: string, targetSeq: number): Promise<void> {
    if (cid === '' || !Number.isSafeInteger(targetSeq) || targetSeq <= 0) {
      throw new Error('INVALID_RECALL_TARGET');
    }
    if (this.connection.getState() !== 'connected') {
      throw new Error('OFFLINE');
    }
    if (this.pendingRecalls.has(cid)) {
      throw new Error('RECALL_PENDING');
    }

    const timer = setTimeout(() => {
      this.enqueue(async () => {
        const pending = this.pendingRecalls.get(cid);
        if (pending?.targetSeq !== targetSeq) return;
        this.pendingRecalls.delete(cid);
        this.emitter.emit('recallResult', { cid, targetSeq, status: 'timeout' });
      });
    }, this.recallTimeoutMs);
    this.pendingRecalls.set(cid, { targetSeq, timer });

    try {
      this.connection.send({
        op: OP.RECALL,
        cid,
        body: { targetSeq },
      });
    } catch (cause) {
      this.clearPendingRecall(cid, targetSeq);
      throw cause;
    }
  }

  async getChatMessages(cid: string): Promise<ChatMessage[]> {
    const [persisted, pending, uploads] = await Promise.all([
      this.messages.getMessages(cid),
      this.outbox.listByCid(cid),
      this.mediaUploads?.listByCid(cid, this.getAccountId()) ?? Promise.resolve([]),
    ]);
    const pendingIds = new Set(pending.map((row) => row.clientMsgId));
    const waiting = uploads
      .filter((task) => !pendingIds.has(task.clientMsgId))
      .map(mediaTaskToChatMessage);
    return [...mergeChatMessages(persisted, pending), ...waiting]
      .sort((a, b) => a.ts - b.ts);
  }

  getReadState(cid: string): Promise<ConversationReadState> {
    return this.messages.getConversationReadState(cid);
  }

  /**
   * 页面确认已展示到 readSeq：先推进本地位点消除未读，再在线上报服务端。
   * 离线时不跨账号缓存；聊天页会在连接恢复后用当前最大 seq 再次调用。
   */
  async markRead(cid: string, readSeq: number): Promise<void> {
    if (cid === '' || !Number.isFinite(readSeq) || readSeq <= 0) return;
    await this.messages.advanceReadSeq(cid, readSeq);
    this.emitter.emit('conversation', { cid });
    if (this.connection.getState() !== 'connected') return;
    this.connection.send({
      op: OP.READ,
      cid,
      body: { readSeq },
    });
  }

  /** 登出 / 卸载时调用：解绑 ConnectionManager 监听 + 清空计时器，避免旧实例继续消费帧。 */
  stop(): void {
    this.offs.splice(0).forEach((off) => off());
    this.ackTimers.forEach((t) => clearTimeout(t));
    this.ackTimers.clear();
    this.pushTimers.forEach((t) => clearTimeout(t));
    this.pushTimers.clear();
    this.pendingRecalls.forEach(({ timer }) => clearTimeout(timer));
    this.pendingRecalls.clear();
  }

  private async dispatch(row: OutboxRow): Promise<void> {
    if (this.connection.getState() !== 'connected') {
      await this.fail(row.cid, row.clientMsgId, 'OFFLINE');
      return;
    }
    const body = row.body == null ? {} : { ...row.body };
    if (row.type === 'IMAGE' || row.type === 'FILE' || row.type === 'AUDIO') {
      delete body.localUri;
      delete body.uploadTaskId;
      delete body.progress;
    }
    this.connection.send({
      op: OP.SEND,
      cid: row.cid,
      clientMsgId: row.clientMsgId,
      type: row.type as MessageType,
      body,
    });
    this.armAckTimer(row.cid, row.clientMsgId);
  }

  private armAckTimer(cid: string, clientMsgId: string): void {
    this.clearAckTimer(clientMsgId);
    const timer = setTimeout(() => {
      this.ackTimers.delete(clientMsgId);
      // 走同一条串行链：避免超时回调与正在处理的 PUSH/ERROR 帧互相插队。
      this.enqueue(() => this.failIfSending(cid, clientMsgId, 'ACK_TIMEOUT'));
    }, this.ackTimeoutMs);
    this.ackTimers.set(clientMsgId, timer);
  }

  private clearAckTimer(clientMsgId: string): void {
    const timer = this.ackTimers.get(clientMsgId);
    if (timer != null) {
      clearTimeout(timer);
      this.ackTimers.delete(clientMsgId);
    }
  }

  private armPushTimer(cid: string, clientMsgId: string): void {
    this.clearPushTimer(clientMsgId);
    const timer = setTimeout(() => {
      this.pushTimers.delete(clientMsgId);
      // ACK 只代表网关受理；最终 PUSH 长期缺失时结束等待，避免气泡永久转圈。
      this.enqueue(() => this.failIfAcked(cid, clientMsgId, 'PUSH_TIMEOUT'));
    }, this.pushTimeoutMs);
    this.pushTimers.set(clientMsgId, timer);
  }

  private clearPushTimer(clientMsgId: string): void {
    const timer = this.pushTimers.get(clientMsgId);
    if (timer != null) {
      clearTimeout(timer);
      this.pushTimers.delete(clientMsgId);
    }
  }

  private async onAck(clientMsgId?: string): Promise<void> {
    if (!clientMsgId) return;
    this.clearAckTimer(clientMsgId);
    await this.outbox.setStatusWhere(clientMsgId, 'sending', 'acked', null);
    const row = await this.outbox.get(clientMsgId);
    if (row != null) {
      if (row.status === 'acked') {
        this.armPushTimer(row.cid, clientMsgId);
      }
      this.emitter.emit('message', { cid: row.cid });
    }
  }

  private async onEnvelope(env: Envelope): Promise<void> {
    if (env.op === OP.PUSH) {
      await this.engine.applyPush(env);
      if (env.clientMsgId) {
        this.clearPushTimer(env.clientMsgId);
      }
      if (env.type === 'RECALL') {
        this.onRecallPush(env);
      }
      return;
    }
    if (env.op === OP.ERROR) {
      await this.onError(env);
      return;
    }
    if (env.op === OP.READ) {
      await this.onRead(env);
    }
  }

  private async onRead(env: Envelope): Promise<void> {
    const cid = env.cid;
    const readSeq = env.body?.readSeq;
    if (typeof cid !== 'string' || cid === '') return;
    if (typeof readSeq !== 'number' || !Number.isFinite(readSeq) || readSeq < 0) return;
    await this.messages.advancePeerReadSeq(cid, readSeq);
    this.emitter.emit('readReceipt', { cid, readSeq });
    this.emitter.emit('conversation', { cid });
  }

  /**
   * ERROR 帧到达时行可能是 sending（还没收到 ACK）也可能是 acked（网关已受理，业务层后校验失败），
   * 两种都要能置失败。用「读当前状态 → 条件写 → 读回确认」门控，
   * 避免 await 让出期间自己的 PUSH 先落地删了行，导致对已成功消息误报 sendError。
   */
  private async onError(env: Envelope): Promise<void> {
    const clientMsgId = env.clientMsgId;
    const reason = typeof env.body?.reason === 'string' ? env.body.reason : 'UNKNOWN';
    if (!clientMsgId) {
      this.onRecallError(env, reason);
      return;
    }
    this.clearAckTimer(clientMsgId);
    this.clearPushTimer(clientMsgId);
    const before = await this.outbox.get(clientMsgId);
    if (before == null) return; // 已被 PUSH 结算，ERROR 晚到，不应误报
    await this.outbox.setStatusWhere(clientMsgId, before.status, 'failed', reason);
    const after = await this.outbox.get(clientMsgId);
    if (after?.status === 'failed' && after.error === reason) {
      this.emitter.emit('message', { cid: before.cid });
      this.emitter.emit('sendError', { cid: before.cid, clientMsgId, reason });
    }
  }

  private onRecallPush(env: Envelope): void {
    const cid = env.cid;
    const targetSeq = env.body?.targetSeq;
    if (typeof cid !== 'string' || cid === '') return;
    if (typeof targetSeq !== 'number' || !Number.isSafeInteger(targetSeq) || targetSeq <= 0) return;
    if (!this.clearPendingRecall(cid, targetSeq)) return;
    this.emitter.emit('recallResult', { cid, targetSeq, status: 'succeeded' });
  }

  private onRecallError(env: Envelope, reason: string): void {
    const cid = env.cid;
    if (typeof cid !== 'string' || cid === '') return;
    const pending = this.pendingRecalls.get(cid);
    if (pending == null) return;
    this.clearPendingRecall(cid, pending.targetSeq);
    this.emitter.emit('recallResult', {
      cid,
      targetSeq: pending.targetSeq,
      status: 'failed',
      reason,
    });
  }

  private clearPendingRecall(cid: string, targetSeq: number): boolean {
    const pending = this.pendingRecalls.get(cid);
    if (pending?.targetSeq !== targetSeq) return false;
    clearTimeout(pending.timer);
    this.pendingRecalls.delete(cid);
    return true;
  }

  private async fail(cid: string, clientMsgId: string, reason: string): Promise<void> {
    await this.outbox.setStatus(clientMsgId, 'failed', reason);
    this.emitter.emit('message', { cid });
    this.emitter.emit('sendError', { cid, clientMsgId, reason });
  }

  /** 只有仍处于 sending 才判失败：ACK 已到（acked）或 PUSH 已到（行没了）都不该被改写。 */
  private async failIfSending(cid: string, clientMsgId: string, reason: string): Promise<void> {
    await this.outbox.setStatusWhere(clientMsgId, 'sending', 'failed', reason);
    const row = await this.outbox.get(clientMsgId);
    if (row?.status === 'failed' && row.error === reason) {
      this.emitter.emit('message', { cid });
      this.emitter.emit('sendError', { cid, clientMsgId, reason });
    }
  }

  /** 只有网关已 ACK、最终 PUSH 仍未到达时才结束等待。 */
  private async failIfAcked(cid: string, clientMsgId: string, reason: string): Promise<void> {
    await this.outbox.setStatusWhere(clientMsgId, 'acked', 'failed', reason);
    const row = await this.outbox.get(clientMsgId);
    if (row?.status === 'failed' && row.error === reason) {
      this.emitter.emit('message', { cid });
      this.emitter.emit('sendError', { cid, clientMsgId, reason });
    }
  }
}
