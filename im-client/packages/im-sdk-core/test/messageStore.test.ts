import { describe, it, expect } from 'vitest';
import { MessageStore, runMigrations, type StoredMessage } from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

function msg(over: Partial<StoredMessage> = {}): StoredMessage {
  return {
    cid: 'c_1_2',
    seq: 1,
    msgId: 'm1',
    clientMsgId: null,
    senderId: 1,
    type: 'TEXT',
    body: { text: 'hi' },
    recalled: false,
    status: 'sent',
    ts: 1000,
    ...over,
  };
}

describe('MessageStore', () => {
  it('writes and reads a message with body round-trip', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    await store.upsertMessage(msg());
    const rows = await store.getMessages('c_1_2');

    expect(rows.length).toBe(1);
    expect(rows[0].seq).toBe(1);
    expect(rows[0].body).toEqual({ text: 'hi' });
    expect(rows[0].recalled).toBe(false);
  });

  it('dedupes by (cid, seq): re-upsert overwrites, no duplicate row', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    await store.upsertMessage(msg({ body: { text: 'v1' } }));
    await store.upsertMessage(msg({ body: { text: 'v2' } }));

    const rows = await store.getMessages('c_1_2');
    expect(rows.length).toBe(1);
    expect(rows[0].body).toEqual({ text: 'v2' });
  });

  it('returns messages ordered by seq ascending', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    await store.upsertMessage(msg({ seq: 3 }));
    await store.upsertMessage(msg({ seq: 1 }));
    await store.upsertMessage(msg({ seq: 2 }));

    const rows = await store.getMessages('c_1_2');
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it('tracks synced_seq per conversation (default 0)', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    expect(await store.getSyncedSeq('c_1_2')).toBe(0);
    await store.setSyncedSeq('c_1_2', 5);
    expect(await store.getSyncedSeq('c_1_2')).toBe(5);
  });

  it('upserts and lists conversations', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    await store.upsertConversation({
      cid: 'g_10',
      type: 'GROUP',
      groupId: 10,
      lastMsgSeq: 7,
      lastMsgPreview: 'hello',
    });
    const rows = await store.getConversations();
    expect(rows.length).toBe(1);
    expect(rows[0].cid).toBe('g_10');
    expect(rows[0].lastMsgSeq).toBe(7);
  });
});
