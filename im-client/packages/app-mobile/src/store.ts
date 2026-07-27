import { create } from 'zustand';
import type { TransportState } from '@im/sdk-core';
import { sdk } from './sdk';

interface AppState {
  loggedIn: boolean;
  connState: TransportState;
  error: string | null;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => {
  sdk.connection.on('state', (s) => set({ connState: s }));
  return {
    loggedIn: false,
    connState: 'closed',
    error: null,
    async login(u, p) {
      set({ error: null });
      try {
        await sdk.auth.login(u, p);
        set({ loggedIn: true });
        await sdk.connection.start();
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    async logout() {
      sdk.connection.stop();
      await sdk.auth.logout();
      set({ loggedIn: false });
    },
  };
});
