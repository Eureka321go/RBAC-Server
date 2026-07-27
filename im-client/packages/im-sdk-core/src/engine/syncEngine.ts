import type { Emitter } from '../events/emitter';
import type { MessageStore, StoredMessage } from '../store/messageStore';

export interface SdkEvents extends Record<string, unknown> {
  message: { cid: string };
  conversation: { cid: string };
}

/**
 * 同步引擎壳：SQLite 单一事实源的落点。
 * M0 只做"落库 + 发变更事件"；M1+ 在此扩展 PUSH/pull 归一、clientMsgId 对账、撤回改写。
 */
export class SyncEngine {
  constructor(
    private readonly store: MessageStore,
    private readonly emitter: Emitter<SdkEvents>,
  ) {}

  async applyIncoming(m: StoredMessage): Promise<void> {
    await this.store.upsertMessage(m);
    this.emitter.emit('message', { cid: m.cid });
    this.emitter.emit('conversation', { cid: m.cid });
  }
}
