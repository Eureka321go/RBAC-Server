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
      try {
        const authed = await sdk.auth.isAuthenticated();
        if (!authed) return;
        // 本地还有 access token：拉一次 /auth/me 顺带验证 token 是否仍然有效，
        // 有效则恢复登录态并直接把 WS 连起来，免得杀进程重开还要再登录一次。
        const me = await sdk.auth.fetchMe();
        set({ loggedIn: true, myId: me.id });
        await sdk.connection.start();
      } catch {
        // token 过期/被强退：fetchMe 会抛错，清掉本地残留 token，保持未登录态，
        // 不能停在"已读到 token 但没验证通过"的半登录状态。
        await sdk.auth.logout();
      } finally {
        // boot 绝不能因为上面任何异常就不置 booted，否则 App 会永远停在
        // "初始化本地数据库…" 白屏。
        set({ booted: true });
      }
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
