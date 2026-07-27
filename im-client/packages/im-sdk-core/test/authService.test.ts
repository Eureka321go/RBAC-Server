import { describe, it, expect } from 'vitest';
import { AuthService, TOKEN_KEYS, type ApiResult, type LoginData } from '../src/index';
import type { Http, SecureStore } from '../src/index';

class FakeHttp implements Http {
  posts: Array<{ path: string; body: unknown }> = [];
  nextPost: unknown;
  async get<T>(): Promise<T> { throw new Error('not used'); }
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
