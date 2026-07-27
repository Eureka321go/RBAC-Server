import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConnectionManager,
  Emitter,
  OP,
  type Transport,
  type TransportState,
  type AppLifecycle,
  type Envelope,
} from '../src/index';

class FakeTransport implements Transport {
  connects: string[] = [];
  sent: string[] = [];
  closed = 0;
  private stateH?: (s: TransportState) => void;
  private msgH?: (t: string) => void;
  connect(url: string) { this.connects.push(url); }
  send(t: string) { this.sent.push(t); }
  onMessage(h: (t: string) => void) { this.msgH = h; }
  onState(h: (s: TransportState) => void) { this.stateH = h; }
  close() { this.closed++; this.stateH?.('closed'); }
  // 测试助手
  emitState(s: TransportState) { this.stateH?.(s); }
  emitMessage(t: string) { this.msgH?.(t); }
}

class FakeLifecycle implements AppLifecycle {
  private fg?: () => void;
  onForeground(h: () => void) { this.fg = h; }
  onBackground() {}
  triggerForeground() { this.fg?.(); }
}

const opts = {
  wsBaseUrl: 'ws://localhost:9001/im',
  deviceId: 'dev-1',
  heartbeatMs: 25000,
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
  random: () => 0, // 抖动确定化
};

describe('ConnectionManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('start connects with token + deviceId in the url', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    await cm.start();
    expect(t.connects).toHaveLength(1);
    expect(t.connects[0]).toBe('ws://localhost:9001/im?token=tokX&deviceId=dev-1');
    expect(cm.getState()).toBe('connecting');
  });

  it('does not connect when there is no token', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => null, opts);
    await cm.start();
    expect(t.connects).toHaveLength(0);
    expect(cm.getState()).toBe('closed');
  });

  it('transitions to connected and starts heartbeat', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    await cm.start();
    t.emitState('connected');
    expect(cm.getState()).toBe('connected');
    vi.advanceTimersByTime(25000);
    expect(t.sent).toHaveLength(1);
    expect(JSON.parse(t.sent[0]).op).toBe('PING');
  });

  it('reconnects with backoff after an unexpected close', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    await cm.start();          // connect #1
    t.emitState('connected');
    t.emitState('closed');     // 意外断开
    expect(cm.getState()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000); // backoffBase * 2^0
    expect(t.connects).toHaveLength(2);      // 重连 #2
  });

  it('does not reconnect after manual stop', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    await cm.start();
    t.emitState('connected');
    cm.stop();
    expect(cm.getState()).toBe('closed');
    await vi.advanceTimersByTimeAsync(60000);
    expect(t.connects).toHaveLength(1); // 无新连接
  });

  it('foreground forces immediate reconnect when not connected', async () => {
    const t = new FakeTransport();
    const life = new FakeLifecycle();
    const cm = new ConnectionManager(t, life, async () => 'tokX', opts);
    await cm.start();
    t.emitState('connected');
    t.emitState('closed');   // 进入 reconnecting，计时器还没到
    life.triggerForeground();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.connects.length).toBeGreaterThanOrEqual(2); // 立即重连
  });

  it('routes ACK frames to the ack event and others to envelope', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    const acks: Array<{ clientMsgId?: string }> = [];
    const envs: Envelope[] = [];
    cm.on('ack', (a) => acks.push(a));
    cm.on('envelope', (e) => envs.push(e));
    await cm.start();
    t.emitState('connected');
    t.emitMessage(JSON.stringify({ op: OP.ACK, clientMsgId: 'c1' }));
    t.emitMessage(JSON.stringify({ op: OP.PUSH, cid: 'c_1_2', seq: 5 }));
    expect(acks).toEqual([{ clientMsgId: 'c1' }]);
    expect(envs).toHaveLength(1);
    expect(envs[0].seq).toBe(5);
  });
});
