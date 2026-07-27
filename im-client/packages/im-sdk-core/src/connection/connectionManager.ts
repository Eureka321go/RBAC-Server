import { Emitter } from '../events/emitter';
import { OP, type Envelope } from '../protocol/types';
import type { AppLifecycle, Transport, TransportState } from '../ports/index';

export interface ConnectionOptions {
  wsBaseUrl: string;
  deviceId: string;
  heartbeatMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  random?: () => number;
}

export interface ConnectionEvents extends Record<string, unknown> {
  state: TransportState;
  envelope: Envelope;
  ack: { clientMsgId?: string };
}

const DEFAULTS = { heartbeatMs: 25000, backoffBaseMs: 1000, backoffMaxMs: 30000 };

export class ConnectionManager {
  private readonly emitter = new Emitter<ConnectionEvents>();
  private state: TransportState = 'closed';
  private attempts = 0;
  private manualStop = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly heartbeatMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
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
    this.stopHeartbeat();
    this.transport.close();
    this.setState('closed');
  }

  send(env: Envelope): void {
    this.transport.send(JSON.stringify(env));
  }

  private async openNow(): Promise<void> {
    this.clearReconnect();
    const token = await this.getToken();
    if (token == null) {
      this.setState('closed');
      return;
    }
    const url =
      `${this.opts.wsBaseUrl}?token=${encodeURIComponent(token)}` +
      `&deviceId=${encodeURIComponent(this.opts.deviceId)}`;
    this.setState('connecting');
    this.transport.connect(url);
  }

  private onTransportState(s: TransportState): void {
    if (s === 'connected') {
      this.attempts = 0;
      this.setState('connected');
      this.startHeartbeat();
      return;
    }
    if (s === 'closed') {
      this.stopHeartbeat();
      if (this.manualStop) {
        this.setState('closed');
      } else {
        this.scheduleReconnect();
      }
    }
  }

  private onMessage(text: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(text) as Envelope;
    } catch {
      return; // 非 JSON 帧忽略，不炸连接
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
    this.heartbeatTimer = setInterval(() => {
      this.transport.send(JSON.stringify({ op: 'PING', ts: Date.now() }));
    }, this.heartbeatMs);
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

  private setState(s: TransportState): void {
    this.state = s;
    this.emitter.emit('state', s);
  }
}
