import type { ApiResult } from '../auth/authService';
import type { Emitter } from '../events/emitter';
import type { RestMessage, SdkEvents, SyncEngine } from '../engine/syncEngine';
import type { Http } from '../ports/index';
import type { GroupService } from '../group/groupService';
import {
  MessageStore,
  type ConversationRow,
} from '../store/messageStore';

interface ConversationSnapshot {
  cid: string;
  type: 'SINGLE' | 'GROUP';
  groupId: number | null;
  peerId: number | null;
  peerName: string | null;
  lastMsgSeq: number;
  lastMsgPreview: string | null;
  lastReadSeq: number;
  unreadCount: number;
  mentionSeq: number;
  hasMention: boolean;
  peerReadSeq: number | null;
}

interface PullResult {
  messages: RestMessage[];
  hasMore: boolean;
  nextSinceSeq: number;
}

interface CreateSingleConversationResult {
  cid: string;
}

const PAGE_SIZE = 100;

/** REST 会话快照与增量消息同步；所有页面仍只从 SQLite 读取。 */
export class SyncService {
  private allFlight: Promise<void> | null = null;
  private readonly cidFlights = new Map<string, Promise<void>>();

  constructor(
    private readonly http: Http,
    private readonly engine: SyncEngine,
    private readonly store: MessageStore,
    private readonly emitter: Emitter<SdkEvents>,
    private readonly groups?: GroupService,
  ) {}

  getConversations(): Promise<ConversationRow[]> {
    return this.store.getConversationRows();
  }

  activateAccount(userId: number): Promise<void> {
    return this.store.activateAccount(userId);
  }

  async setConversationDisplayName(cid: string, name: string): Promise<void> {
    await this.store.setConversationDisplayName(cid, name);
    this.emitter.emit('conversation', { cid });
  }

  async removeLocalConversation(cid: string): Promise<void> {
    await this.store.removeConversation(cid);
    this.emitter.emit('conversation', { cid });
  }

  /** 先让服务端幂等建立双方成员关系，再进入新单聊页面。 */
  async createSingleConversation(peerId: number): Promise<string> {
    const res = await this.http.post<ApiResult<CreateSingleConversationResult>>(
      '/im/conversations/single',
      { peerId },
    );
    if (res.code !== 200 || typeof res.data?.cid !== 'string') {
      throw new Error(res.message || 'create single conversation failed');
    }
    // 会话已创建即可进入页面；列表快照后台刷新，失败不影响本次创建结果。
    void this.syncAll().catch(() => {});
    return res.data.cid;
  }

  /** 全量同步 single-flight：连接抖动和用户下拉刷新不会叠加多轮分页请求。 */
  syncAll(): Promise<void> {
    if (this.allFlight != null) return this.allFlight;
    const flight = this.doSyncAll().finally(() => {
      if (this.allFlight === flight) this.allFlight = null;
    });
    this.allFlight = flight;
    return flight;
  }

  /** 单会话 single-flight：进入页面与后台全量同步撞车时复用同一个请求链。 */
  syncConversation(cid: string): Promise<void> {
    const running = this.cidFlights.get(cid);
    if (running != null) return running;
    const flight = this.pullConversation(cid).finally(() => {
      if (this.cidFlights.get(cid) === flight) this.cidFlights.delete(cid);
    });
    this.cidFlights.set(cid, flight);
    return flight;
  }

  private async doSyncAll(): Promise<void> {
    this.emitter.emit('syncState', { running: true, error: null });
    let error: string | null = null;
    try {
      const res = await this.http.get<ApiResult<ConversationSnapshot[]>>('/im/conversations');
      if (res.code !== 200 || !Array.isArray(res.data)) {
        throw new Error(res.message || 'sync conversations failed');
      }

      const now = Date.now();
      for (let index = 0; index < res.data.length; index += 1) {
        const item = res.data[index];
        await this.store.upsertConversationSnapshot({
          ...item,
          peerId: item.peerId ?? null,
          peerName: item.peerName ?? null,
          displayName: null,
          lastMsgPreview: item.lastMsgPreview ?? null,
          peerReadSeq: item.peerReadSeq ?? null,
          updatedAt: now - index,
        });
        if (item.type === 'GROUP' && item.groupId != null && this.groups != null) {
          try {
            const group = await this.groups.getGroup(item.groupId);
            await this.store.setConversationDisplayName(item.cid, group.name);
          } catch {
            // 群详情暂时不可用时保留 SQLite 旧群名，不阻断其他会话与消息同步。
          }
        }
        this.emitter.emit('conversation', { cid: item.cid });
      }

      // op-sqlite 同一连接上不并发开事务；逐会话同步也让服务端压力更可控。
      for (const item of res.data) {
        await this.syncConversation(item.cid);
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'sync failed';
      throw cause;
    } finally {
      this.emitter.emit('syncState', { running: false, error });
    }
  }

  private async pullConversation(cid: string): Promise<void> {
    let sinceSeq = await this.store.getSyncedSeq(cid);
    while (true) {
      const res = await this.http.get<ApiResult<PullResult>>('/im/messages', {
        cid,
        sinceSeq,
        limit: PAGE_SIZE,
      });
      if (res.code !== 200 || res.data == null || !Array.isArray(res.data.messages)) {
        throw new Error(res.message || `sync ${cid} failed`);
      }

      for (const message of res.data.messages) {
        await this.engine.applyRestMessage(message);
      }
      if (!res.data.hasMore) return;

      const next = res.data.nextSinceSeq;
      if (!Number.isFinite(next) || next <= sinceSeq) {
        throw new Error(`sync cursor did not advance: ${cid}`);
      }
      sinceSeq = next;
    }
  }
}
