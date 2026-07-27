import type { Transport, TransportState } from '@im/sdk-core';

/** 用 RN 全局 WebSocket 实现 Transport。只报 connected/closed，重连交给 core。 */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private stateH: (s: TransportState) => void = () => {};
  private msgH: (t: string) => void = () => {};

  connect(url: string): void {
    this.close();
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => this.stateH('connected');
    ws.onclose = () => this.stateH('closed');
    ws.onerror = () => {
      // onerror 后通常紧跟 onclose；这里不重复报状态，交给 onclose
    };
    ws.onmessage = (ev: WebSocketMessageEvent) => {
      if (typeof ev.data === 'string') this.msgH(ev.data);
    };
  }

  send(text: string): void {
    this.ws?.send(text);
  }

  onMessage(handler: (t: string) => void): void {
    this.msgH = handler;
  }

  onState(handler: (s: TransportState) => void): void {
    this.stateH = handler;
  }

  close(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
