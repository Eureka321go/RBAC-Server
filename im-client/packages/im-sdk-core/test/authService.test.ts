import { describe, it, expect } from 'vitest';
import { AuthService, TOKEN_KEYS, type ApiResult, type LoginData } from '../src/index';
import type { Http, SecureStore } from '../src/index';

class FakeHttp implements Http {
  posts: Array<{ path: string; body: unknown }> = [];
  gets: Array<{ path: string }> = [];
  nextPost: unknown;
  nextGet: unknown;
  async get<T>(path: string): Promise<T> {
    this.gets.push({ path });
    return this.nextGet as T;
  }
  async post<T>(path: string, body?: unknown): Promise<T> {
    this.posts.push({ path, body });
    return this.nextPost as T;
  }
  async put(): Promise<void> {}
}

class MemStore implements SecureStore {
  m = new Map<string, string>();
  async get(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async del(k: string) { this.m.delete(k); }
}

function ok(data: LoginData): ApiResult<LoginData> {
  return { code: 200, message: 'success', data };
}

describe('AuthService', () => {
  it('login stores access+refresh tokens on success', async () => {
    const http = new FakeHttp();
    const store = new MemStore();
    http.nextPost = ok({ accessToken: 'a1', refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 3600 });
    const auth = new AuthService(http, store);

    await auth.login('admin', 'pw');

    expect(http.posts[0]).toEqual({ path: '/auth/login', body: { username: 'admin', password: 'pw' } });
    expect(await store.get(TOKEN_KEYS.access)).toBe('a1');
    expect(await store.get(TOKEN_KEYS.refresh)).toBe('r1');
  });

  it('login throws and stores nothing when code != 200', async () => {
    const http = new FakeHttp();
    const store = new MemStore();
    http.nextPost = { code: 401, message: 'bad credentials', data: null };
    const auth = new AuthService(http, store);

    await expect(auth.login('admin', 'wrong')).rejects.toThrow('bad credentials');
    expect(await store.get(TOKEN_KEYS.access)).toBeNull();
  });

  it('getAccessToken returns stored token or null', async () => {
    const store = new MemStore();
    const auth = new AuthService(new FakeHttp(), store);
    expect(await auth.getAccessToken()).toBeNull();
    await store.set(TOKEN_KEYS.access, 'a1');
    expect(await auth.getAccessToken()).toBe('a1');
  });

  it('isAuthenticated reflects presence of access token', async () => {
    const store = new MemStore();
    const auth = new AuthService(new FakeHttp(), store);
    expect(await auth.isAuthenticated()).toBe(false);
    await store.set(TOKEN_KEYS.access, 'a1');
    expect(await auth.isAuthenticated()).toBe(true);
  });

  it('logout calls /auth/logout and clears tokens', async () => {
    const http = new FakeHttp();
    const store = new MemStore();
    await store.set(TOKEN_KEYS.access, 'a1');
    await store.set(TOKEN_KEYS.refresh, 'r1');
    http.nextPost = { code: 200, message: 'success', data: null };
    const auth = new AuthService(http, store);

    await auth.logout();

    expect(http.posts.some((p) => p.path === '/auth/logout')).toBe(true);
    expect(await store.get(TOKEN_KEYS.access)).toBeNull();
    expect(await store.get(TOKEN_KEYS.refresh)).toBeNull();
  });

  it('logout clears tokens even if server call fails', async () => {
    const store = new MemStore();
    await store.set(TOKEN_KEYS.access, 'a1');
    const failingHttp: Http = {
      async get<T>(): Promise<T> { throw new Error('x'); },
      async post<T>(): Promise<T> { throw new Error('network down'); },
      async put() {},
    };
    const auth = new AuthService(failingHttp, store);

    await auth.logout(); // must not throw
    expect(await store.get(TOKEN_KEYS.access)).toBeNull();
  });
});

describe('AuthService.fetchMe', () => {
  it('fetches current user and caches the id', async () => {
    const http = new FakeHttp();
    const store = new MemStore();
    http.nextGet = {
      code: 200,
      message: 'success',
      data: { id: 7, username: 'admin', nickname: '管理员' },
    };
    const auth = new AuthService(http, store);
    expect(auth.getMyId()).toBeNull();

    const me = await auth.fetchMe();

    expect(http.gets[0]).toEqual({ path: '/auth/me' });
    expect(me.id).toBe(7);
    expect(auth.getMyId()).toBe(7);
  });

  it('clears cached id on logout', async () => {
    const http = new FakeHttp();
    const store = new MemStore();
    http.nextGet = {
      code: 200,
      message: 'success',
      data: { id: 7, username: 'admin', nickname: '管理员' },
    };
    http.nextPost = { code: 200, message: 'success', data: null };
    const auth = new AuthService(http, store);

    await auth.fetchMe();
    await auth.logout();

    expect(auth.getMyId()).toBeNull();
  });

  it('login resets cached id to avoid cross-account leak', async () => {
    const http = new FakeHttp();
    const store = new MemStore();
    http.nextGet = {
      code: 200,
      message: 'success',
      data: { id: 7, username: 'admin', nickname: '管理员' },
    };
    const auth = new AuthService(http, store);

    await auth.fetchMe();
    expect(auth.getMyId()).toBe(7);

    // 未先 logout，直接切换账号登录：myId 必须清空，逼调用方重新 fetchMe，
    // 否则会残留上一个账号的 id，造成跨账号串号。
    http.nextPost = ok({ accessToken: 'a2', refreshToken: 'r2', tokenType: 'Bearer', expiresIn: 3600 });
    await auth.login('other', 'pw2');

    expect(auth.getMyId()).toBeNull();
  });
});
