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

/** 登录编排：调用 RBAC /auth 接口，token 落 SecureStore。 */
export class AuthService {
  constructor(
    private readonly http: Http,
    private readonly store: SecureStore,
  ) {}

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
