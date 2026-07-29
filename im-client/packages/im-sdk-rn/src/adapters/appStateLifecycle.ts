import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';
import type { AppLifecycle } from '@im/sdk-core';

export class AppStateLifecycle implements AppLifecycle {
  private readonly foregroundHandlers = new Set<() => void>();
  private readonly backgroundHandlers = new Set<() => void>();
  private readonly sub: NativeEventSubscription;

  constructor() {
    this.sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') this.foregroundHandlers.forEach((handler) => handler());
      else if (s === 'background') this.backgroundHandlers.forEach((handler) => handler());
    });
  }

  onForeground(handler: () => void): () => void {
    this.foregroundHandlers.add(handler);
    return () => this.foregroundHandlers.delete(handler);
  }

  onBackground(handler: () => void): () => void {
    this.backgroundHandlers.add(handler);
    return () => this.backgroundHandlers.delete(handler);
  }

  /** 移除 AppState 监听（多实例/测试场景避免泄漏）。 */
  stop(): void {
    this.sub.remove();
    this.foregroundHandlers.clear();
    this.backgroundHandlers.clear();
  }
}
