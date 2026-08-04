import { create } from 'zustand';
import type { TransportState } from '@im/sdk-core';
import { sdk } from './sdk';
import {
  cancelPendingPushPermissionPrompt,
  preparePushAfterLogin,
} from './push/pushPermission';
import { pushRegistration } from './push/pushRegistration';

interface AppState {
  booted: boolean;
  loggedIn: boolean;
  myId: number | null;
  displayName: string | null;
  connState: TransportState;
  error: string | null;
  boot: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAppStore = create<AppState>(set => {
  sdk.connection.on('state', s => set({ connState: s }));
  sdk.auth.onSessionExpired(() => {
    cancelPendingPushPermissionPrompt();
    void pushRegistration.deactivate();
    sdk.connection.stop();
    set({
      loggedIn: false,
      myId: null,
      displayName: null,
      error: '登录已过期，请重新登录',
    });
  });
  return {
    booted: false,
    loggedIn: false,
    myId: null,
    displayName: null,
    connState: 'closed',
    error: null,
    async boot() {
      try {
        // await 放进 try：本地库建表/迁移本身失败（库损坏、磁盘满、schema 冲突）
        // 也要走 catch/finally，不能让这条路径绕过 booted 置位。
        await sdk.ready; // 等建表完成，之后才能读写本地库
        const authed = await sdk.auth.isAuthenticated();
        if (!authed) return;
        // 本地还有 access token：拉一次 /auth/me 顺带验证 token 是否仍然有效，
        // 有效则恢复登录态并直接把 WS 连起来，免得杀进程重开还要再登录一次。
        try {
          const me = await sdk.auth.fetchMe();
          await sdk.sync.activateAccount(me.id);
          set({
            loggedIn: true,
            myId: me.id,
            displayName: me.nickname?.trim() || me.username,
          });
          void preparePushAfterLogin(me.id).catch(() => {});
          await sdk.connection.start();
        } catch {
          // token 过期/被强退：fetchMe 会抛错，清掉本地残留 token，保持未登录态，
          // 不能停在"已读到 token 但没验证通过"的半登录状态。这是登录态问题，
          // 跟 sdk.ready 失败（数据库问题）分开处理，不要互相误伤。
          await sdk.auth.logout();
        }
      } catch (e) {
        // 走到这里说明是 sdk.ready（本地库建表/迁移）或 isAuthenticated 本身
        // 抛的错——跟用户登录态无关，不能调 sdk.auth.logout() 清 token，
        // 只把错误信息写进 error 供 UI 提示用户（如"本地数据库初始化失败"）。
        set({ error: (e as Error).message });
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
        await sdk.sync.activateAccount(me.id);
        set({
          loggedIn: true,
          myId: me.id,
          displayName: me.nickname?.trim() || me.username,
        });
        void preparePushAfterLogin(me.id).catch(() => {});
        await sdk.connection.start();
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    async logout() {
      cancelPendingPushPermissionPrompt();
      await pushRegistration.deactivate().catch(() => {});
      await sdk.voice.recording.cancel().catch(() => {});
      await sdk.voice.player.stop().catch(() => {});
      await sdk.voice.audioSession.deactivate().catch(() => {});
      sdk.connection.stop();
      await sdk.auth.logout();
      set({ loggedIn: false, myId: null, displayName: null });
    },
  };
});
