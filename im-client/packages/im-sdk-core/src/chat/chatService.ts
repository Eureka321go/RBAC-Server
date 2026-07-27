import type { Emitter } from '../events/emitter';
import type { ConnectionManager } from '../connection/connectionManager';
import type { SdkEvents, SyncEngine } from '../engine/syncEngine';
import type { MessageStore } from '../store/messageStore';
import {
  mergeChatMessages,
  type ChatMessage,
  type OutboxRow,
  type OutboxStore,
} from '../store/outboxStore';
import { OP, type Envelope, type MessageType } from '../protocol/types';
import type { Ids } from '../ports/index';

export interface ChatOptions {
  /** 发出 SEND 后多久没收到 ACK 就判失败（毫秒） */
  ackTimeoutMs?: number;
}

const DEFAULT_ACK_TIMEOUT_MS = 15000;

/**
 * 发送编排 + 下行帧路由。
 * 发送即以 clientMsgId 乐观写 outbox；ACK 表示网关受理；自己的 PUSH 到达才算最终落定。
 */
export class ChatService {
  private readonly ackTimeoutMs: number;
  private readonly ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
  ) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
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
  async sendText(cid: string, text: string): Promise<string> {
    const row: OutboxRow = {
      clientMsgId: this.ids.uuid(),
      cid,
      type: 'TEXT',
      body: { text },
      status: 'sending',
      error: null,
      createdAt: this.ids.now(),
    };
    await this.outbox.insert(row);
    this.emitter.emit('message', { cid });
    await this.dispatch(row);
    return row.clientMsgId;
  }

  /** 复用同一 clientMsgId 重发；服务端对 clientMsgId 幂等，不会产生重复消息。 */
  async resend(clientMsgId: string): Promise<void> {
    const row = await this.outbox.get(clientMsgId);
    if (row == null) return;
    await this.outbox.setStatus(clientMsgId, 'sending', null);
    this.emitter.emit('message', { cid: row.cid });
    await this.dispatch({ ...row, status: 'sending', error: null });
  }

  async getChatMessages(cid: string): Promise<ChatMessage[]> {
    const [persisted, pending] = await Promise.all([
      this.messages.getMessages(cid),
      this.outbox.listByCid(cid),
    ]);
    return mergeChatMessages(persisted, pending);
  }

  /** 登出 / 卸载时调用：解绑 ConnectionManager 监听 + 清空计时器，避免旧实例继续消费帧。 */
  stop(): void {
    this.offs.splice(0).forEach((off) => off());
    this.ackTimers.forEach((t) => clearTimeout(t));
    this.ackTimers.clear();
  }

  private async dispatch(row: OutboxRow): Promise<void> {
    if (this.connection.getState() !== 'connected') {
      await this.fail(row.cid, row.clientMsgId, 'OFFLINE');
      return;
    }
    this.connection.send({
      op: OP.SEND,
      cid: row.cid,
      clientMsgId: row.clientMsgId,
      type: row.type as MessageType,
      body: row.body ?? {},
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

  private async onAck(clientMsgId?: string): Promise<void> {
    if (!clientMsgId) return;
    this.clearAckTimer(clientMsgId);
    await this.outbox.setStatusWhere(clientMsgId, 'sending', 'acked', null);
    const row = await this.outbox.get(clientMsgId);
    if (row != null) {
      this.emitter.emit('message', { cid: row.cid });
    }
  }

  private async onEnvelope(env: Envelope): Promise<void> {
    if (env.op === OP.PUSH) {
      await this.engine.applyPush(env);
      return;
    }
    if (env.op === OP.ERROR) {
      await this.onError(env);
    }
    // 其余 op（READ 等）留给后续里程碑，这里忽略不动。
  }

  /**
   * ERROR 帧到达时行可能是 sending（还没收到 ACK）也可能是 acked（网关已受理，业务层后校验失败），
   * 两种都要能置失败。用「读当前状态 → 条件写 → 读回确认」门控，
   * 避免 await 让出期间自己的 PUSH 先落地删了行，导致对已成功消息误报 sendError。
   */
  private async onError(env: Envelope): Promise<void> {
    const clientMsgId = env.clientMsgId;
    if (!clientMsgId) return;
    const reason = typeof env.body?.reason === 'string' ? env.body.reason : 'UNKNOWN';
    this.clearAckTimer(clientMsgId);
    const before = await this.outbox.get(clientMsgId);
    if (before == null) return; // 已被 PUSH 结算，ERROR 晚到，不应误报
    await this.outbox.setStatusWhere(clientMsgId, before.status, 'failed', reason);
    const after = await this.outbox.get(clientMsgId);
    if (after?.status === 'failed' && after.error === reason) {
      this.emitter.emit('message', { cid: before.cid });
      this.emitter.emit('sendError', { cid: before.cid, clientMsgId, reason });
    }
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
}
