import type { Http, SecureStore } from '../ports/index';

export interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

export interface LoginData {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

export const TOKEN_KEYS = {
  access: 'im.accessToken',
  refresh: 'im.refreshToken',
} as const;

export interface MeData {
  id: number;
  username: string;
  nickname: string;
}

/** 登录编排：调用 RBAC /auth 接口，token 落 SecureStore。 */
export class AuthService {
  private myId: number | null = null;
  private sessionExpired = false;
  private readonly sessionExpiredHandlers = new Set<() => void>();

  constructor(
    private readonly http: Http,
    private readonly store: SecureStore,
  ) {}

  /** 取当前登录用户；cid 拼接与"己方消息"判定都依赖它。 */
  async fetchMe(): Promise<MeData> {
    const res = await this.http.get<ApiResult<MeData>>('/auth/me');
    if (res.code !== 200 || res.data == null) {
      throw new Error(res.message || 'fetch me failed');
    }
    this.myId = res.data.id;
    return res.data;
  }

  /** 已缓存的当前用户 id；未登录/未拉取返回 null。 */
  getMyId(): number | null {
    return this.myId;
  }

  async login(username: string, password: string): Promise<void> {
    const res = await this.http.post<ApiResult<LoginData>>('/auth/login', {
      username,
      password,
    });
    if (res.code !== 200 || res.data == null) {
      throw new Error(res.message || 'login failed');
    }
    await this.persistTokens(res.data);
    this.sessionExpired = false;
    // 切账号场景（未先 logout 直接 login）：清掉上一个账号缓存的 id，
    // 逼调用方重新 fetchMe，避免跨账号串号窗口。
    this.myId = null;
  }

  /** 尽力通知服务端登出（失败忽略），本地 token 无论如何清空。 */
  async logout(): Promise<void> {
    try {
      await this.http.post('/auth/logout');
    } catch {
      // best-effort：网络失败也要清本地 token
    }
    await this.clearSession();
  }

  /** 使用轮换式 refresh token 换取新令牌；刷新令牌先落盘，避免中途退出后丢失新会话。 */
  async refreshAccessToken(): Promise<string> {
    const refreshToken = await this.getRefreshToken();
    if (refreshToken == null || refreshToken === '') {
      throw new Error('REFRESH_TOKEN_MISSING');
    }
    const res = await this.http.post<ApiResult<LoginData>>('/auth/refresh-token', {
      refreshToken,
    });
    if (
      res.code !== 200
      || res.data == null
      || typeof res.data.accessToken !== 'string'
      || res.data.accessToken === ''
      || typeof res.data.refreshToken !== 'string'
      || res.data.refreshToken === ''
    ) {
      throw new Error(res.message || 'refresh token failed');
    }
    await this.persistTokens(res.data);
    this.sessionExpired = false;
    return res.data.accessToken;
  }

  /** 自动刷新失败时清理本地会话，并通知宿主切回登录页。 */
  async expireSession(): Promise<void> {
    if (this.sessionExpired) return;
    this.sessionExpired = true;
    await this.clearSession();
    this.sessionExpiredHandlers.forEach((handler) => handler());
  }

  onSessionExpired(handler: () => void): () => void {
    this.sessionExpiredHandlers.add(handler);
    return () => this.sessionExpiredHandlers.delete(handler);
  }

  getAccessToken(): Promise<string | null> {
    return this.store.get(TOKEN_KEYS.access);
  }

  getRefreshToken(): Promise<string | null> {
    return this.store.get(TOKEN_KEYS.refresh);
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.getAccessToken()) != null;
  }

  private async persistTokens(tokens: Pick<LoginData, 'accessToken' | 'refreshToken'>): Promise<void> {
    await this.store.set(TOKEN_KEYS.refresh, tokens.refreshToken);
    await this.store.set(TOKEN_KEYS.access, tokens.accessToken);
  }

  private async clearSession(): Promise<void> {
    await this.store.del(TOKEN_KEYS.access);
    await this.store.del(TOKEN_KEYS.refresh);
    this.myId = null;
  }
}
