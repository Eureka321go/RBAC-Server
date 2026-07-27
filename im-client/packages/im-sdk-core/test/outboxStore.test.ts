import { describe, it, expect } from 'vitest';
import {
  MessageStore,
  OutboxStore,
  mergeChatMessages,
  runMigrations,
  type OutboxRow,
  type StoredMessage,
} from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    clientMsgId: 'cmid-1',
    cid: 'c_1_2',
    type: 'TEXT',
    body: { text: 'hi' },
    status: 'sending',
    error: null,
    createdAt: 1000,
    ...over,
  };
}

function stored(over: Partial<StoredMessage> = {}): StoredMessage {
  return {
    cid: 'c_1_2',
    seq: 1,
    msgId: 'm1',
    clientMsgId: null,
    senderId: 2,
    type: 'TEXT',
    body: { text: 'from peer' },
    recalled: false,
    status: 'sent',
    ts: 900,
    ...over,
  };
}

async function freshDb() {
  const db = await createSqljsDatabase();
  await runMigrations(db);
  return db;
}

describe('OutboxStore', () => {
  it('creates the outbox table via migrations and is idempotent', async () => {
    const db = await freshDb();
    await runMigrations(db); // 重复调用不得报错
    const rows = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='outbox'`,
    );
    expect(rows.length).toBe(1);
  });

  it('inserts and reads back a row', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row());
    const got = await outbox.get('cmid-1');
    expect(got).not.toBeNull();
    expect(got!.cid).toBe('c_1_2');
    expect(got!.body).toEqual({ text: 'hi' });
    expect(got!.status).toBe('sending');
    expect(got!.createdAt).toBe(1000);
  });

  it('returns null for an unknown clientMsgId', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    expect(await outbox.get('nope')).toBeNull();
  });

  it('setStatus overwrites status and error', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row());
    await outbox.setStatus('cmid-1', 'failed', 'NOT_MEMBER');
    const got = await outbox.get('cmid-1');
    expect(got!.status).toBe('failed');
    expect(got!.error).toBe('NOT_MEMBER');
  });

  it('setStatusWhere only applies when the current status matches', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row());
    await outbox.setStatus('cmid-1', 'acked', null);

    // 想从 sending 改成 failed，但当前已是 acked —— 不应生效
    await outbox.setStatusWhere('cmid-1', 'sending', 'failed', 'ACK_TIMEOUT');
    expect((await outbox.get('cmid-1'))!.status).toBe('acked');

    // 条件匹配时生效
    await outbox.setStatusWhere('cmid-1', 'acked', 'failed', 'ACK_TIMEOUT');
    const got = await outbox.get('cmid-1');
    expect(got!.status).toBe('failed');
    expect(got!.error).toBe('ACK_TIMEOUT');
  });

  it('deletes a row', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row());
    await outbox.delete('cmid-1');
    expect(await outbox.get('cmid-1')).toBeNull();
  });

  it('lists rows of one cid ordered by created_at', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row({ clientMsgId: 'b', createdAt: 2000 }));
    await outbox.insert(row({ clientMsgId: 'a', createdAt: 1000 }));
    await outbox.insert(row({ clientMsgId: 'other', cid: 'c_3_4', createdAt: 500 }));
    const list = await outbox.listByCid('c_1_2');
    expect(list.map((r) => r.clientMsgId)).toEqual(['a', 'b']);
  });
});

describe('mergeChatMessages', () => {
  it('puts persisted messages first and pending ones last', () => {
    const merged = mergeChatMessages(
      [stored({ seq: 1, ts: 900 }), stored({ seq: 2, msgId: 'm2', ts: 950 })],
      [row({ clientMsgId: 'p1', createdAt: 1000 })],
    );
    expect(merged.map((m) => m.seq)).toEqual([1, 2, null]);
    expect(merged[2].clientMsgId).toBe('p1');
    expect(merged[2].status).toBe('sending');
    expect(merged[2].senderId).toBeNull();
    expect(merged[2].ts).toBe(1000);
  });

  it('maps persisted rows into ChatMessage shape', () => {
    const merged = mergeChatMessages([stored()], []);
    expect(merged[0]).toEqual({
      cid: 'c_1_2',
      seq: 1,
      clientMsgId: null,
      msgId: 'm1',
      senderId: 2,
      type: 'TEXT',
      body: { text: 'from peer' },
      recalled: false,
      status: 'sent',
      error: null,
      ts: 900,
    });
  });
});
