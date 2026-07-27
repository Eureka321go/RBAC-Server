import { AppState, type AppStateStatus } from 'react-native';
import type { AppLifecycle } from '@im/sdk-core';

export class AppStateLifecycle implements AppLifecycle {
  private fg: () => void = () => {};
  private bg: () => void = () => {};

  constructor() {
    AppState.addEventListener('change', (s: AppStateStatus) => {
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
}
