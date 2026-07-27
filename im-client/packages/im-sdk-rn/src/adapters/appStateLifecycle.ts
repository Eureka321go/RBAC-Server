import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';
import type { AppLifecycle } from '@im/sdk-core';

export class AppStateLifecycle implements AppLifecycle {
  private fg: () => void = () => {};
  private bg: () => void = () => {};
  private readonly sub: NativeEventSubscription;

  constructor() {
    this.sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') this.fg();
      else if (s === 'background') this.bg();
    });
  }

  onForeground(handler: () => void): void {
    this.fg = handler;
  }

  onBackground(handler: () => void): void {
    this.bg = handler;
  }

  /** 移除 AppState 监听（多实例/测试场景避免泄漏）。 */
  stop(): void {
    this.sub.remove();
  }
}
