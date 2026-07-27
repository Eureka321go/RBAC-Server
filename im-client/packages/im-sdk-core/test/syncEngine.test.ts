import { describe, it, expect } from 'vitest';
import {
  Emitter,
  MessageStore,
  OutboxStore,
  SyncEngine,
  runMigrations,
  type Envelope,
  type SdkEvents,
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
});
