import { describe, it, expect } from 'vitest';
import {
  Emitter,
  MessageStore,
  SyncEngine,
  runMigrations,
  type SdkEvents,
  type StoredMessage,
} from '../src/index';
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

describe('SyncEngine', () => {
  it('persists incoming message and emits message + conversation events', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);
    const emitter = new Emitter<SdkEvents>();

    const messageCids: string[] = [];
    const convCids: string[] = [];
    emitter.on('message', (p) => messageCids.push(p.cid));
    emitter.on('conversation', (p) => convCids.push(p.cid));

    const engine = new SyncEngine(store, emitter);
    await engine.applyIncoming(msg());

    const rows = await store.getMessages('c_1_2');
    expect(rows.length).toBe(1);
    expect(messageCids).toEqual(['c_1_2']);
    expect(convCids).toEqual(['c_1_2']);
  });
});
