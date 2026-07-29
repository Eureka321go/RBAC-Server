import { describe, it, expect } from 'vitest';
import {
  Emitter,
  MessageStore,
  OutboxStore,
  SyncEngine,
  runMigrations,
  type Database,
  type Envelope,
  type SdkEvents,
  type SqlValue,
} from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

function push(over: Partial<Envelope> = {}): Envelope {
  return {
    op: 'PUSH',
    cid: 'c_1_2',
    seq: 10,
    msgId: 'm10',
    senderId: 2,
    type: 'TEXT',
    body: { text: 'hello' },
    ts: 1000,
    ...over,
  };
}

/**
 * 测试专用 Database 代理：真正模拟"tx 参数与外层连接是两回事"的驱动语义
 * （比如 op-sqlite 的事务回调可能给的是独立会话句柄）。
 *
 * 关键设计：底层真实 sql.js 连接是单连接的，直接委托 db.tx() 时，不管代码用
 * 回调参数 tx 还是构造时的 this.store，写入都落在同一个连接、同一个已 BEGIN
 * 的事务里，ROLLBACK 时全部一起被撤销——这样测试锁不住"必须用 tx 参数"这个
 * 约束（同一条底层连接下，用哪个 JS 引用调用都会被牵连回滚，无法制造分歧）。
 *
 * 所以这里不委托真实 tx()，而是自己用"暂存区"实现事务语义：
 *   - 事务回调收到的 tx 参数：exec() 只是把语句暂存到内存数组，不真正落库；
 *     只有回调整体不抛错才会把暂存的语句依次真正执行（模拟 COMMIT）；
 *     回调中途抛错则暂存区直接丢弃，天然"回滚"，且从未真正碰过底层连接。
 *   - 代理自身（外层）的 exec()：模拟"绕过事务、直接在外层连接上跑"的语义，
 *     立即真实落库，不受后续事务成败影响。
 * 如果实现误用构造时的 this.store（绑定的是外层 db，而不是回调参数 tx）去
 * 发送某条语句，那条语句会通过外层 exec() 立即永久落库，即使事务随后失败，
 * 这条“半写”也不会被撤销——测试断言里的"落库为 0 行"就会失败，从而锁住
 * "必须用 tx 参数"这个约束。
 */
class StagedTxDatabase implements Database {
  constructor(
    private readonly inner: Database,
    private readonly failAtStagedExecCall: number,
  ) {}

  async exec(sql: string, params?: SqlValue[]): Promise<void> {
    // 绕过事务参数、直接用外层句柄发出的语句：视为脱离事务保护，立即真实落库。
    await this.inner.exec(sql, params);
  }

  async query<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
    return this.inner.query<T>(sql, params);
  }

  async tx(fn: (tx: Database) => Promise<void>): Promise<void> {
    const staged: Array<{ sql: string; params?: SqlValue[] }> = [];
    let stagedCount = 0;
    const txHandle: Database = {
      exec: async (sql, params) => {
        stagedCount += 1;
        if (stagedCount === this.failAtStagedExecCall) {
          throw new Error('injected failure inside transaction');
        }
        staged.push({ sql, params });
      },
      query: (sql, params) => this.inner.query(sql, params),
      tx: (fn2) => this.tx(fn2),
    };
    // 回调抛错则直接向上抛，staged 里攒的语句从未落库——等价于 ROLLBACK。
    await fn(txHandle);
    // 回调成功完成才真正提交：把暂存语句依次落到底层连接——等价于 COMMIT。
    for (const s of staged) {
      await this.inner.exec(s.sql, s.params);
    }
  }
}

async function setup() {
  const db = await createSqljsDatabase();
  await runMigrations(db);
  const emitter = new Emitter<SdkEvents>();
  const engine = new SyncEngine(db, emitter);
  return { db, emitter, engine, messages: new MessageStore(db), outbox: new OutboxStore(db) };
}

describe('SyncEngine.applyPush', () => {
  it('persists a peer message and emits message + conversation', async () => {
    const { engine, emitter, messages } = await setup();
    const seen: string[] = [];
    emitter.on('message', (p) => seen.push(`m:${p.cid}`));
    emitter.on('conversation', (p) => seen.push(`c:${p.cid}`));

    await engine.applyPush(push());

    const rows = await messages.getMessages('c_1_2');
    expect(rows.length).toBe(1);
    expect(rows[0].seq).toBe(10);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].body).toEqual({ text: 'hello' });
    expect(seen).toEqual(['m:c_1_2', 'c:c_1_2']);
  });

  it('reconciles own message: inserts row and removes the outbox entry', async () => {
    const { engine, messages, outbox } = await setup();
    await outbox.insert({
      clientMsgId: 'cmid-9',
      cid: 'c_1_2',
      type: 'TEXT',
      body: { text: 'hello' },
      status: 'acked',
      error: null,
      createdAt: 500,
    });

    await engine.applyPush(push({ clientMsgId: 'cmid-9', senderId: 1 }));

    expect(await outbox.get('cmid-9')).toBeNull();
    const rows = await messages.getMessages('c_1_2');
    expect(rows.length).toBe(1);
    expect(rows[0].clientMsgId).toBe('cmid-9');
  });

  it('is idempotent for a repeated (cid, seq)', async () => {
    const { engine, messages } = await setup();
    await engine.applyPush(push());
    await engine.applyPush(push());
    expect((await messages.getMessages('c_1_2')).length).toBe(1);
  });

  it('does not roll back conversation/sync positions on out-of-order arrival', async () => {
    const { engine, messages, db } = await setup();
    await engine.applyPush(push({ seq: 43, msgId: 'm43' }));
    await engine.applyPush(push({ seq: 42, msgId: 'm42', body: { text: 'older' } }));

    const convs = await db.query<{ last_msg_seq: number; last_msg_preview: string }>(
      `SELECT last_msg_seq, last_msg_preview FROM conversations WHERE cid = 'c_1_2'`,
    );
    expect(convs[0].last_msg_seq).toBe(43);
    expect(convs[0].last_msg_preview).toBe('hello'); // 旧消息不得覆盖预览
    expect(await messages.getSyncedSeq('c_1_2')).toBe(43);
    expect((await messages.getMessages('c_1_2')).length).toBe(2);
  });

  it('drops frames without cid or seq', async () => {
    const { engine, emitter, messages } = await setup();
    let events = 0;
    emitter.on('message', () => (events += 1));

    await engine.applyPush({ op: 'PUSH', seq: 1 } as Envelope);
    await engine.applyPush({ op: 'PUSH', cid: 'c_1_2' } as Envelope);

    expect((await messages.getMessages('c_1_2')).length).toBe(0);
    expect(events).toBe(0);
  });

  it('records group conversation type from the cid', async () => {
    const { engine, db } = await setup();
    await engine.applyPush(push({ cid: 'g_77' }));
    const convs = await db.query<{ type: string; group_id: number }>(
      `SELECT type, group_id FROM conversations WHERE cid = 'g_77'`,
    );
    expect(convs[0].type).toBe('GROUP');
    expect(convs[0].group_id).toBe(77);
  });

  it('rolls back the whole transaction when a step in the middle fails', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const messages = new MessageStore(db);
    const outbox = new OutboxStore(db);
    await outbox.insert({
      clientMsgId: 'cmid-fail',
      cid: 'c_1_2',
      type: 'TEXT',
      body: { text: 'hello' },
      status: 'acked',
      error: null,
      createdAt: 500,
    });

    // tx 回调里暂存的 exec 顺序：① messages upsert ② outbox delete ③ advanceConversation ④ advanceSyncedSeq
    // 让第 3 条失败：前两条只是"暂存"未提交，必须验证回调抛错后暂存区整体作废、底层库始终未被写入。
    const failingDb = new StagedTxDatabase(db, 3);
    const emitter = new Emitter<SdkEvents>();
    const engine = new SyncEngine(failingDb, emitter);
    let messageEvents = 0;
    emitter.on('message', () => (messageEvents += 1));
    emitter.on('conversation', () => (messageEvents += 1));

    await expect(
      engine.applyPush(push({ clientMsgId: 'cmid-fail', senderId: 1 })),
    ).rejects.toThrow('injected failure inside transaction');

    // 落库/对账/位点三者必须全部保持"未发生"状态——不能出现半写。
    expect((await messages.getMessages('c_1_2')).length).toBe(0);
    expect(await outbox.get('cmid-fail')).not.toBeNull();
    const convs = await db.query<{ last_msg_seq: number }>(
      `SELECT last_msg_seq FROM conversations WHERE cid = 'c_1_2'`,
    );
    expect(convs.length).toBe(0);
    expect(await messages.getSyncedSeq('c_1_2')).toBe(0);
    expect(messageEvents).toBe(0);
  });
});
