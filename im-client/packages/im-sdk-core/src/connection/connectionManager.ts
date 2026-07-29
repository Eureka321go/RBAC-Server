import { Emitter } from '../events/emitter';
import { OP, type Envelope } from '../protocol/types';
import type { AppLifecycle, Transport, TransportState } from '../ports/index';

export interface ConnectionOptions {
  wsBaseUrl: string;
  /** 固定设备标识，或用于从平台安全存储异步恢复设备标识的提供器。 */
  deviceId: string | (() => Promise<string>);
  heartbeatMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** connecting 后多久未 open 判定超时并重连（毫秒） */
  connectTimeoutMs?: number;
  /** 连续多少个心跳周期收不到任何入站帧就判死连并重连 */
  maxMissedHeartbeats?: number;
  random?: () => number;
}

export interface ConnectionEvents extends Record<string, unknown> {
  state: TransportState;
  envelope: Envelope;
  ack: { clientMsgId?: string };
}

const DEFAULTS = {
  heartbeatMs: 25000,
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
  connectTimeoutMs: 10000,
  maxMissedHeartbeats: 2,
};

export class ConnectionManager {
  private readonly emitter = new Emitter<ConnectionEvents>();
  private state: TransportState = 'closed';
  private attempts = 0;
  private manualStop = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly heartbeatMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly connectTimeoutMs: number;
  private readonly maxMissedHeartbeats: number;
  private missedHeartbeats = 0;
  private readonly random: () => number;

  constructor(
    private readonly transport: Transport,
    private readonly lifecycle: AppLifecycle,
    private readonly getToken: () => Promise<string | null>,
    private readonly opts: ConnectionOptions,
  ) {
    this.heartbeatMs = opts.heartbeatMs ?? DEFAULTS.heartbeatMs;
    this.backoffBaseMs = opts.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
    this.backoffMaxMs = opts.backoffMaxMs ?? DEFAULTS.backoffMaxMs;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;
    this.maxMissedHeartbeats = opts.maxMissedHeartbeats ?? DEFAULTS.maxMissedHeartbeats;
    this.random = opts.random ?? Math.random;
    this.transport.onState((s) => this.onTransportState(s));
    this.transport.onMessage((t) => this.onMessage(t));
    this.lifecycle.onForeground(() => this.onForeground());
  }

  on<K extends keyof ConnectionEvents>(
    key: K,
    fn: (payload: ConnectionEvents[K]) => void,
  ): () => void {
    return this.emitter.on(key, fn);
  }

  getState(): TransportState {
    return this.state;
  }

  async start(): Promise<void> {
    this.manualStop = false;
    await this.openNow();
  }

  stop(): void {
    this.manualStop = true;
    this.clearReconnect();
    this.clearConnectTimer();
    this.stopHeartbeat();
    this.transport.close();
    this.setState('closed');
  }

  send(env: Envelope): void {
    this.transport.send(JSON.stringify(env));
  }

  private async openNow(): Promise<void> {
    this.clearReconnect();
    this.clearConnectTimer();
    const token = await this.getToken();
    if (token == null) {
      this.setState('closed');
      return;
    }
    const deviceId =
      typeof this.opts.deviceId === 'string'
        ? this.opts.deviceId
        : await this.opts.deviceId();
    const url =
      `${this.opts.wsBaseUrl}?token=${encodeURIComponent(token)}` +
      `&deviceId=${encodeURIComponent(deviceId)}`;
    this.setState('connecting');
    this.transport.connect(url);
    this.connectTimer = setTimeout(() => this.onConnectTimeout(), this.connectTimeoutMs);
  }

  private onConnectTimeout(): void {
    if (this.state !== 'connecting') return; // 已 open/close，不处理
    this.clearConnectTimer();
    this.transport.close(); // 拆掉半开 socket，避免迟到的 connected
    // FakeTransport.close 会同步回抛 closed 走重连；真实适配器已置空 handler 不回抛，
    // 故此处兜底：仍停在 connecting 才主动重连，避免双重调度。
    if (this.state === 'connecting' && !this.manualStop) {
      this.scheduleReconnect();
    }
  }

  private onTransportState(s: TransportState): void {
    if (s === 'connected') {
      this.attempts = 0;
      this.missedHeartbeats = 0;
      this.clearConnectTimer();
      this.setState('connected');
      this.startHeartbeat();
      return;
    }
    if (s === 'closed') {
      this.clearConnectTimer();
      this.stopHeartbeat();
      if (this.manualStop) {
        this.setState('closed');
      } else {
        this.scheduleReconnect();
      }
    }
  }

  private onMessage(text: string): void {
    this.missedHeartbeats = 0; // 任意入站帧都证明连接存活
    let env: Envelope;
    try {
      env = JSON.parse(text) as Envelope;
    } catch {
      return; // 非 JSON 帧忽略，不炸连接
    }
    if (env.op === OP.PONG) {
      return; // 心跳应答：只用于存活判定，不向上层扇出
    }
    if (env.op === OP.ACK) {
      this.emitter.emit('ack', { clientMsgId: env.clientMsgId });
    } else {
      this.emitter.emit('envelope', env);
    }
  }

  private onForeground(): void {
    if (this.state !== 'connected') {
      void this.openNow();
    }
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    const delay = this.backoffDelay(this.attempts);
    this.attempts += 1;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      void this.openNow();
    }, delay);
  }

  private backoffDelay(attempt: number): number {
    const raw = this.backoffBaseMs * 2 ** attempt;
    const capped = Math.min(this.backoffMaxMs, raw);
    // 半抖动：[capped/2, capped]
    return Math.floor(capped * (0.5 + 0.5 * this.random()));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(() => this.onHeartbeatTick(), this.heartbeatMs);
  }

  private onHeartbeatTick(): void {
    if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
      // 连续多个周期无入站帧：判定为半开死连，主动断开触发重连
      this.stopHeartbeat();
      this.transport.close();
      // FakeTransport.close 同步回抛 closed 已走重连；真实适配器置空 handler 不回抛，
      // 故仍停在 connected 时兜底重连，避免双重调度。
      if (this.state === 'connected' && !this.manualStop) {
        this.scheduleReconnect();
      }
      return;
    }
    this.missedHeartbeats += 1;
    this.transport.send(JSON.stringify({ op: OP.PING, ts: Date.now() }));
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer != null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private setState(s: TransportState): void {
    this.state = s;
    this.emitter.emit('state', s);
  }
}
