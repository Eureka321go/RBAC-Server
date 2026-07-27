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
    await this.store.set(TOKEN_KEYS.access, res.data.accessToken);
    await this.store.set(TOKEN_KEYS.refresh, res.data.refreshToken);
  }

  /** 尽力通知服务端登出（失败忽略），本地 token 无论如何清空。 */
  async logout(): Promise<void> {
    try {
      await this.http.post('/auth/logout');
    } catch {
      // best-effort：网络失败也要清本地 token
    }
    await this.store.del(TOKEN_KEYS.access);
    await this.store.del(TOKEN_KEYS.refresh);
    this.myId = null;
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
}
