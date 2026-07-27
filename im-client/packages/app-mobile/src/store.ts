import { create } from 'zustand';
import type { TransportState } from '@im/sdk-core';
import { sdk } from './sdk';

interface AppState {
  booted: boolean;
  loggedIn: boolean;
  myId: number | null;
  connState: TransportState;
  error: string | null;
  boot: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => {
  sdk.connection.on('state', (s) => set({ connState: s }));
  return {
    booted: false,
    loggedIn: false,
    myId: null,
    connState: 'closed',
    error: null,
    async boot() {
      await sdk.ready; // 等建表完成，之后才能读写本地库
      set({ booted: true });
    },
    async login(u, p) {
      set({ error: null });
      try {
        await sdk.auth.login(u, p);
        const me = await sdk.auth.fetchMe();
        set({ loggedIn: true, myId: me.id });
        await sdk.connection.start();
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    async logout() {
      sdk.connection.stop();
      sdk.chat.stop();
      await sdk.auth.logout();
      set({ loggedIn: false, myId: null });
    },
  };
});
