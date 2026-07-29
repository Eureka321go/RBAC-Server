import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ChatService,
  ConnectionManager,
  Emitter,
  MessageStore,
  OutboxStore,
  SyncEngine,
  runMigrations,
  type AppLifecycle,
  type Database,
  type Ids,
  type SdkEvents,
  type Transport,
  type TransportState,
} from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

class FakeTransport implements Transport {
  sent: string[] = [];
  private stateH?: (s: TransportState) => void;
  private msgH?: (t: string) => void;
  connect() {}
  send(t: string) { this.sent.push(t); }
  onMessage(h: (t: string) => void) { this.msgH = h; }
  onState(h: (s: TransportState) => void) { this.stateH = h; }
  close() { this.stateH?.('closed'); }
  emitState(s: TransportState) { this.stateH?.(s); }
  emitMessage(t: string) { this.msgH?.(t); }
}

class FakeLifecycle implements AppLifecycle {
  onForeground() {}
  onBackground() {}
}

const ids: Ids = (() => {
  let n = 0;
  return {
    uuid: () => `cmid-${++n}`,
    now: () => 1000 + n,
  };
})();

interface Ctx {
  db: Database;
  transport: FakeTransport;
  connection: ConnectionManager;
  chat: ChatService;
  outbox: OutboxStore;
  messages: MessageStore;
  emitter: Emitter<SdkEvents>;
}

async function setup(connected = true): Promise<Ctx> {
  const db = await createSqljsDatabase();
  await runMigrations(db);
  const transport = new FakeTransport();
  const connection = new ConnectionManager(
    transport,
    new FakeLifecycle(),
    async () => 'tok',
    { wsBaseUrl: 'ws://x/im', deviceId: 'd1', random: () => 0 },
  );
  await connection.start();
  if (connected) transport.emitState('connected');

  const emitter = new Emitter<SdkEvents>();
  const engine = new SyncEngine(db, emitter);
  const outbox = new OutboxStore(db);
  const chat = new ChatService(connection, engine, new MessageStore(db), outbox, ids, emitter, {
    ackTimeoutMs: 15000,
  });
  return { db, transport, connection, chat, outbox, messages: new MessageStore(db), emitter };
}

describe('ChatService.sendText', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes an outbox row and emits a SEND frame', async () => {
    const { chat, outbox, transport } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    const row = await outbox.get(cmid);
    expect(row!.status).toBe('sending');
    expect(row!.body).toEqual({ text: 'hi' });

    const frames = transport.sent.map((s) => JSON.parse(s));
    const send = frames.find((f) => f.op === 'SEND');
    expect(send).toMatchObject({
      op: 'SEND',
      cid: 'c_1_2',
      clientMsgId: cmid,
      type: 'TEXT',
      body: { text: 'hi' },
    });
  });

  it('fails immediately with OFFLINE when not connected, without sending a frame', async () => {
    const { chat, outbox, transport } = await setup(false);
    const errors: string[] = [];
    chat.on('sendError', (p) => errors.push(p.reason));

    const cmid = await chat.sendText('c_1_2', 'hi');

    const row = await outbox.get(cmid);
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('OFFLINE');
    expect(transport.sent.filter((s) => JSON.parse(s).op === 'SEND')).toHaveLength(0);
    expect(errors).toEqual(['OFFLINE']);
  });

  it('marks the row acked when the ACK frame arrives', async () => {
    const { chat, outbox, transport } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    transport.emitMessage(JSON.stringify({ op: 'ACK', clientMsgId: cmid }));
    await vi.advanceTimersByTimeAsync(0);

    expect((await outbox.get(cmid))!.status).toBe('acked');
  });

  it('fails the row with ACK_TIMEOUT when no ACK arrives in time', async () => {
    const { chat, outbox } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    await vi.advanceTimersByTimeAsync(15000);

    const row = await outbox.get(cmid);
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('ACK_TIMEOUT');
  });

  it('does not overwrite an acked row when the timeout fires late', async () => {
    const { chat, outbox, transport } = await setup();
    const errors: string[] = [];
    chat.on('sendError', (p) => errors.push(p.reason));
    const cmid = await chat.sendText('c_1_2', 'hi');

    transport.emitMessage(JSON.stringify({ op: 'ACK', clientMsgId: cmid }));
    await vi.advanceTimersByTimeAsync(20000);

    expect((await outbox.get(cmid))!.status).toBe('acked');
    // 迟到的超时不得对一条已经成功的消息补发 sendError（brief 明确要求不得误报）。
    expect(errors).toEqual([]);
  });

  it('does not resurrect the row or emit sendError when the timeout fires after its own PUSH already settled it', async () => {
    const { chat, outbox, transport } = await setup();
    const errors: string[] = [];
    chat.on('sendError', (p) => errors.push(p.reason));
    const cmid = await chat.sendText('c_1_2', 'hi');

    transport.emitMessage(
      JSON.stringify({
        op: 'PUSH',
        cid: 'c_1_2',
        seq: 11,
        msgId: 'm11',
        senderId: 1,
        clientMsgId: cmid,
        type: 'TEXT',
        body: { text: 'hi' },
        ts: 1234,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await outbox.get(cmid)).toBeNull(); // PUSH 已落定，行被删除

    await vi.advanceTimersByTimeAsync(15000); // ACK 超时定时器到点

    expect(await outbox.get(cmid)).toBeNull(); // 不应被复活
    expect(errors).toEqual([]);
  });

  it('marks the row failed with the reason from an ERROR frame', async () => {
    const { chat, outbox, transport } = await setup();
    const errors: Array<{ clientMsgId: string; reason: string }> = [];
    chat.on('sendError', (p) => errors.push({ clientMsgId: p.clientMsgId, reason: p.reason }));

    const cmid = await chat.sendText('c_1_2', 'hi');
    transport.emitMessage(
      JSON.stringify({ op: 'ERROR', cid: 'c_1_2', clientMsgId: cmid, body: { reason: 'NOT_MEMBER' } }),
    );
    await vi.advanceTimersByTimeAsync(0);

    const row = await outbox.get(cmid);
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('NOT_MEMBER');
    expect(errors).toEqual([{ clientMsgId: cmid, reason: 'NOT_MEMBER' }]);
  });
});

describe('ChatService.resend', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-sends with the same clientMsgId', async () => {
    const { chat, outbox, transport } = await setup(false);
    const cmid = await chat.sendText('c_1_2', 'hi'); // OFFLINE 失败

    transport.emitState('connected');
    await chat.resend(cmid);

    const sends = transport.sent.map((s) => JSON.parse(s)).filter((f) => f.op === 'SEND');
    expect(sends).toHaveLength(1);
    expect(sends[0].clientMsgId).toBe(cmid);
    expect((await outbox.get(cmid))!.status).toBe('sending');
  });

  it('ignores an unknown clientMsgId', async () => {
    const { chat } = await setup();
    await expect(chat.resend('nope')).resolves.toBeUndefined();
  });
});

describe('ChatService.stop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ignores ACK/PUSH frames delivered after stop()', async () => {
    const { chat, outbox, transport, messages } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    chat.stop();

    transport.emitMessage(JSON.stringify({ op: 'ACK', clientMsgId: cmid }));
    transport.emitMessage(
      JSON.stringify({
        op: 'PUSH',
        cid: 'c_1_2',
        seq: 11,
        msgId: 'm11',
        senderId: 1,
        clientMsgId: cmid,
        type: 'TEXT',
        body: { text: 'hi' },
        ts: 1234,
      }),
    );
    await vi.advanceTimersByTimeAsync(20000);

    // 停掉之后不再消费任何帧：outbox 行原样停在 sending，消息也没落库。
    expect((await outbox.get(cmid))!.status).toBe('sending');
    expect(await messages.getMessages('c_1_2')).toHaveLength(0);
  });
});

describe('ChatService downstream routing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('processes two frames delivered in the same tick without breaking the tx boundary', async () => {
    // RN 的原生事件桥会在同一 JS turn 批量投递多帧；fire-and-forget 处理会让
    // 第二帧在第一帧的 db.tx 尚未提交时插入，炸穿 sql.js 的事务边界（Critical-1 的回归锁）。
    const { transport, messages } = await setup();
    const push = (seq: number) =>
      JSON.stringify({
        op: 'PUSH',
        cid: 'c_1_2',
        seq,
        msgId: `m${seq}`,
        senderId: 2,
        clientMsgId: null,
        type: 'TEXT',
        body: { text: `t${seq}` },
        ts: 1000 + seq,
      });
    transport.emitMessage(push(21));
    transport.emitMessage(push(22));
    await vi.advanceTimersByTimeAsync(0);

    const rows = await messages.getMessages('c_1_2');
    expect(rows.map((r) => r.seq)).toEqual([21, 22]);
  });

  it('routes PUSH into the engine and reconciles the outbox row', async () => {
    const { chat, outbox, transport, messages } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    transport.emitMessage(
      JSON.stringify({
        op: 'PUSH',
        cid: 'c_1_2',
        seq: 11,
        msgId: 'm11',
        senderId: 1,
        clientMsgId: cmid,
        type: 'TEXT',
        body: { text: 'hi' },
        ts: 1234,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(await outbox.get(cmid)).toBeNull();
    const rows = await messages.getMessages('c_1_2');
    expect(rows).toHaveLength(1);
    expect(rows[0].seq).toBe(11);
  });
});

describe('ChatService.getChatMessages', () => {
  it('returns persisted messages first and pending ones last', async () => {
    const { chat, messages } = await setup(false);
    await messages.upsertMessage({
      cid: 'c_1_2',
      seq: 5,
      msgId: 'm5',
      clientMsgId: null,
      senderId: 2,
      type: 'TEXT',
      body: { text: 'peer' },
      recalled: false,
      status: 'sent',
      ts: 100,
    });
    const cmid = await chat.sendText('c_1_2', 'mine');

    const list = await chat.getChatMessages('c_1_2');
    expect(list.map((m) => m.seq)).toEqual([5, null]);
    expect(list[1].clientMsgId).toBe(cmid);
    expect(list[1].status).toBe('failed'); // 未连接 → OFFLINE
  });
});
