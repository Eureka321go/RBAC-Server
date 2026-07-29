# IM 客户端 M1（登录 + WS 长连接）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 RN 客户端能用 RBAC 账号登录拿 JWT 存进安全存储，并与 im-gateway 建立带心跳、退避重连、回前台强制重连的 WebSocket 长连接；登录页与连接状态条可见。

**Architecture:** 延续 M0 的六边形。可移植逻辑放 `@im/sdk-core`：`AuthService`（登录/登出/取 token，依赖注入的 `Http`+`SecureStore`）与 `ConnectionManager`（WS 连接状态机 + 心跳 + 指数退避重连，依赖注入的 `Transport`+`AppLifecycle`+token 提供者）。平台细节放 `@im/sdk-rn` 适配器（axios / RN WebSocket / keychain / AppState / ids）。`app-mobile` 是首个 RN 工程，只做登录页 + 连接状态条。

**Tech Stack:** TypeScript、vitest（core，`vi.useFakeTimers` 驱动定时器）、axios、react-native-keychain、React Native CLI、React Navigation、Zustand。

## Global Constraints

- 沿用 M0 monorepo：`im-client/`（npm workspaces）。core 包 `@im/sdk-core`、RN 适配器包 `@im/sdk-rn`、新 App 包 `app-mobile`。
- `im-sdk-core/src/**` 禁止 import `react`/`react-native`/`op-sqlite`/axios/node 内置模块。core 只用跨端都有的全局（`setTimeout`/`clearTimeout`/`setInterval`/`WebSocket` 类型经端口注入，不直接 `new WebSocket`）。定时器用全局 `setTimeout`/`setInterval`（RN/Node/浏览器皆有，非 node 内置 import），测试用 `vi.useFakeTimers()` 控制。
- 后端契约（context-path `/api`）：`POST /auth/login` body `{username,password}` → `Result<LoginData>`；`Result<T> = {code:number,message:string,data:T}`，成功 `code===200`；`LoginData = {accessToken,refreshToken,tokenType,expiresIn}`。`POST /auth/logout`（带 `Authorization: Bearer <accessToken>`）。
- WS 端点：`ws://<host>:9001/im?token=<accessToken>&deviceId=<deviceId>`（token/deviceId 用 `encodeURIComponent`）。网关读空闲 60s 断连 → 心跳间隔默认 25000ms；网关忽略非 `SEND` 的 op，故心跳帧用 `{"op":"PING","ts":<now>}`（合法 Envelope、被忽略、重置读空闲）。
- SecureStore key：accessToken=`im.accessToken`、refreshToken=`im.refreshToken`。
- 提交在 `feat/im` 分支，前缀 `feat(im-client):` / `chore(im-client):`，并带两行 trailer（Co-Authored-By + Claude-Session）。
- **执行边界**：Phase A（Task 1-2）是 core 纯 TS，Node 里 `npm test` 验证。Phase B（Task 3-4）触及 RN 原生与 App，本仓库 CI/Node 环境无法构建/运行，验证方式为**在本地 RN 环境真机/模拟器手动联调**（每个任务标注了手动验收步骤）。

---

## Phase A · core（Node-TDD）

### Task 1: AuthService（登录 / 登出 / token 存取）

**Files:**
- Create: `im-client/packages/im-sdk-core/src/auth/authService.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`
- Test: `im-client/packages/im-sdk-core/test/authService.test.ts`

**Interfaces:**
- Consumes: `Http`、`SecureStore`（M0 `ports/index`）。
- Produces:
  - 类型 `ApiResult<T> = { code: number; message: string; data: T }`、`LoginData = { accessToken: string; refreshToken: string; tokenType: string; expiresIn: number }`。
  - 常量 `TOKEN_KEYS = { access: 'im.accessToken', refresh: 'im.refreshToken' } as const`。
  - 类 `AuthService`：`constructor(http: Http, store: SecureStore)`；`login(username: string, password: string): Promise<void>`；`logout(): Promise<void>`；`getAccessToken(): Promise<string | null>`；`getRefreshToken(): Promise<string | null>`；`isAuthenticated(): Promise<boolean>`。

- [ ] **Step 1: 写失败测试 `test/authService.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd im-client && npx vitest run test/authService.test.ts --dir packages/im-sdk-core`
Expected: FAIL（`AuthService`/`TOKEN_KEYS` 未从 index 导出）。

- [ ] **Step 3: 写 `src/auth/authService.ts`**

```ts
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
```

- [ ] **Step 4: 从 `src/index.ts` 导出 auth**

在文件末尾追加一行（保留既有全部导出）：

```ts
export * from './auth/authService';
```

- [ ] **Step 5: 运行确认通过**

Run: `cd im-client && npm test`
Expected: PASS（既有 15 + 本任务 6 = 21 个测试通过）。

- [ ] **Step 6: 提交**

```bash
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): core AuthService（RBAC 登录/登出 + token 落 SecureStore）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PhwtB8L5XG37b1BXGFpkQ3"
```

---

### Task 2: ConnectionManager（WS 状态机 + 心跳 + 退避重连）

**Files:**
- Create: `im-client/packages/im-sdk-core/src/connection/connectionManager.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`
- Test: `im-client/packages/im-sdk-core/test/connectionManager.test.ts`

**Interfaces:**
- Consumes: `Transport`、`TransportState`、`AppLifecycle`（M0 `ports/index`）、`Envelope`、`OP`（M0 protocol）、`Emitter`（M0 events）。
- Produces:
  - 类型 `ConnectionOptions = { wsBaseUrl: string; deviceId: string; heartbeatMs?: number; backoffBaseMs?: number; backoffMaxMs?: number; random?: () => number }`。
  - 类型 `ConnectionEvents = { state: TransportState; envelope: Envelope; ack: { clientMsgId?: string } }`。
  - 类 `ConnectionManager`：`constructor(transport: Transport, lifecycle: AppLifecycle, getToken: () => Promise<string | null>, opts: ConnectionOptions)`；`on<K>(k, fn)`（转发内部 Emitter，返回取消订阅函数）；`getState(): TransportState`；`start(): Promise<void>`；`stop(): void`；`send(env: Envelope): void`。
  - 语义：`start` 取 token → 无 token 置 `closed` 不连；有 token 置 `connecting` 并 `transport.connect(url)`。transport 报 `connected` → 归零重连计数、置 `connected`、开心跳。transport 报 `closed`：手动停 → `closed`；否则置 `reconnecting`、按退避 `setTimeout` 后重连（尝试次数递增）。`AppLifecycle.onForeground` 且非 `connected` → 清重连计时器立即重连。收帧：`op===ACK` 发 `ack`；其余发 `envelope`。心跳：`connected` 时每 `heartbeatMs` 发 `{"op":"PING","ts":now}`。

- [ ] **Step 1: 写失败测试 `test/connectionManager.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConnectionManager,
  Emitter,
  OP,
  type Transport,
  type TransportState,
  type AppLifecycle,
  type Envelope,
} from '../src/index';

class FakeTransport implements Transport {
  connects: string[] = [];
  sent: string[] = [];
  closed = 0;
  private stateH?: (s: TransportState) => void;
  private msgH?: (t: string) => void;
  connect(url: string) { this.connects.push(url); }
  send(t: string) { this.sent.push(t); }
  onMessage(h: (t: string) => void) { this.msgH = h; }
  onState(h: (s: TransportState) => void) { this.stateH = h; }
  close() { this.closed++; this.stateH?.('closed'); }
  // 测试助手
  emitState(s: TransportState) { this.stateH?.(s); }
  emitMessage(t: string) { this.msgH?.(t); }
}

class FakeLifecycle implements AppLifecycle {
  private fg?: () => void;
  onForeground(h: () => void) { this.fg = h; }
  onBackground() {}
  triggerForeground() { this.fg?.(); }
}

const opts = {
  wsBaseUrl: 'ws://localhost:9001/im',
  deviceId: 'dev-1',
  heartbeatMs: 25000,
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
  random: () => 0, // 抖动确定化
};

describe('ConnectionManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('start connects with token + deviceId in the url', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    await cm.start();
    expect(t.connects).toHaveLength(1);
    expect(t.connects[0]).toBe('ws://localhost:9001/im?token=tokX&deviceId=dev-1');
    expect(cm.getState()).toBe('connecting');
  });

  it('does not connect when there is no token', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => null, opts);
    await cm.start();
    expect(t.connects).toHaveLength(0);
    expect(cm.getState()).toBe('closed');
  });

  it('transitions to connected and starts heartbeat', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    await cm.start();
    t.emitState('connected');
    expect(cm.getState()).toBe('connected');
    vi.advanceTimersByTime(25000);
    expect(t.sent).toHaveLength(1);
    expect(JSON.parse(t.sent[0]).op).toBe('PING');
  });

  it('reconnects with backoff after an unexpected close', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    await cm.start();          // connect #1
    t.emitState('connected');
    t.emitState('closed');     // 意外断开
    expect(cm.getState()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000); // backoffBase * 2^0
    expect(t.connects).toHaveLength(2);      // 重连 #2
  });

  it('does not reconnect after manual stop', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    await cm.start();
    t.emitState('connected');
    cm.stop();
    expect(cm.getState()).toBe('closed');
    await vi.advanceTimersByTimeAsync(60000);
    expect(t.connects).toHaveLength(1); // 无新连接
  });

  it('foreground forces immediate reconnect when not connected', async () => {
    const t = new FakeTransport();
    const life = new FakeLifecycle();
    const cm = new ConnectionManager(t, life, async () => 'tokX', opts);
    await cm.start();
    t.emitState('connected');
    t.emitState('closed');   // 进入 reconnecting，计时器还没到
    life.triggerForeground();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.connects.length).toBeGreaterThanOrEqual(2); // 立即重连
  });

  it('routes ACK frames to the ack event and others to envelope', async () => {
    const t = new FakeTransport();
    const cm = new ConnectionManager(t, new FakeLifecycle(), async () => 'tokX', opts);
    const acks: Array<{ clientMsgId?: string }> = [];
    const envs: Envelope[] = [];
    cm.on('ack', (a) => acks.push(a));
    cm.on('envelope', (e) => envs.push(e));
    await cm.start();
    t.emitState('connected');
    t.emitMessage(JSON.stringify({ op: OP.ACK, clientMsgId: 'c1' }));
    t.emitMessage(JSON.stringify({ op: OP.PUSH, cid: 'c_1_2', seq: 5 }));
    expect(acks).toEqual([{ clientMsgId: 'c1' }]);
    expect(envs).toHaveLength(1);
    expect(envs[0].seq).toBe(5);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd im-client && npx vitest run test/connectionManager.test.ts --dir packages/im-sdk-core`
Expected: FAIL（`ConnectionManager` 未导出）。

- [ ] **Step 3: 写 `src/connection/connectionManager.ts`**

```ts
import { Emitter } from '../events/emitter';
import { OP, type Envelope } from '../protocol/types';
import type { AppLifecycle, Transport, TransportState } from '../ports/index';

export interface ConnectionOptions {
  wsBaseUrl: string;
  deviceId: string;
  heartbeatMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  random?: () => number;
}

export interface ConnectionEvents extends Record<string, unknown> {
  state: TransportState;
  envelope: Envelope;
  ack: { clientMsgId?: string };
}

const DEFAULTS = { heartbeatMs: 25000, backoffBaseMs: 1000, backoffMaxMs: 30000 };

export class ConnectionManager {
  private readonly emitter = new Emitter<ConnectionEvents>();
  private state: TransportState = 'closed';
  private attempts = 0;
  private manualStop = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly heartbeatMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly random: () => number;

  constructor(
    private readonly transport: Transport,
    private readonly lifecycle: AppLifecycle,
    private readonly getToken: () => Promise<string | null>,
    private readonly opts: ConnectionOptions,
  ) {
    this.heartbeatMs = opts.heartbeatMs ?? DEFAULTS.heartbeatMs;
    this.backoffBaseMs = opts.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
    this.backoffMaxMs = opts.backoffMaxMs ?? DEFAULTS.backoffMaxMs;
    this.random = opts.random ?? Math.random;
    this.transport.onState((s) => this.onTransportState(s));
    this.transport.onMessage((t) => this.onMessage(t));
    this.lifecycle.onForeground(() => this.onForeground());
  }

  on<K extends keyof ConnectionEvents>(
    key: K,
    fn: (payload: ConnectionEvents[K]) => void,
  ): () => void {
    return this.emitter.on(key, fn);
  }

  getState(): TransportState {
    return this.state;
  }

  async start(): Promise<void> {
    this.manualStop = false;
    await this.openNow();
  }

  stop(): void {
    this.manualStop = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.transport.close();
    this.setState('closed');
  }

  send(env: Envelope): void {
    this.transport.send(JSON.stringify(env));
  }

  private async openNow(): Promise<void> {
    this.clearReconnect();
    const token = await this.getToken();
    if (token == null) {
      this.setState('closed');
      return;
    }
    const url =
      `${this.opts.wsBaseUrl}?token=${encodeURIComponent(token)}` +
      `&deviceId=${encodeURIComponent(this.opts.deviceId)}`;
    this.setState('connecting');
    this.transport.connect(url);
  }

  private onTransportState(s: TransportState): void {
    if (s === 'connected') {
      this.attempts = 0;
      this.setState('connected');
      this.startHeartbeat();
      return;
    }
    if (s === 'closed') {
      this.stopHeartbeat();
      if (this.manualStop) {
        this.setState('closed');
      } else {
        this.scheduleReconnect();
      }
    }
  }

  private onMessage(text: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(text) as Envelope;
    } catch {
      return; // 非 JSON 帧忽略，不炸连接
    }
    if (env.op === OP.ACK) {
      this.emitter.emit('ack', { clientMsgId: env.clientMsgId });
    } else {
      this.emitter.emit('envelope', env);
    }
  }

  private onForeground(): void {
    if (this.state !== 'connected') {
      void this.openNow();
    }
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    const delay = this.backoffDelay(this.attempts);
    this.attempts += 1;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      void this.openNow();
    }, delay);
  }

  private backoffDelay(attempt: number): number {
    const raw = this.backoffBaseMs * 2 ** attempt;
    const capped = Math.min(this.backoffMaxMs, raw);
    // 半抖动：[capped/2, capped]
    return Math.floor(capped * (0.5 + 0.5 * this.random()));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.transport.send(JSON.stringify({ op: 'PING', ts: Date.now() }));
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(s: TransportState): void {
    this.state = s;
    this.emitter.emit('state', s);
  }
}
```

- [ ] **Step 4: 从 `src/index.ts` 导出 connection**

在文件末尾追加一行（保留既有全部导出）：

```ts
export * from './connection/connectionManager';
```

- [ ] **Step 5: 运行确认通过**

Run: `cd im-client && npm test`
Expected: PASS（21 + 本任务 7 = 28 个测试通过）。

- [ ] **Step 6: tsc 类型检查**

Run: `cd im-client && npx tsc --noEmit -p packages/im-sdk-core/tsconfig.json`
Expected: 无错误（exit 0）。

- [ ] **Step 7: 提交**

```bash
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): core ConnectionManager（WS 状态机+心跳+退避重连+回前台重连）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PhwtB8L5XG37b1BXGFpkQ3"
```

---

## Phase B · RN 适配器 + App（手动验证，需本地 RN 环境）

> 说明：以下两任务触及 React Native 原生工具链，无法在纯 Node/CI 环境构建与运行。代码完整给出；验收方式为在本地起后端(:8080)+网关(:9001)后，用真机/模拟器手动联调。执行时不做 Node 自动化断言，改为手动验收清单。

### Task 3: `@im/sdk-rn` 适配器 + createSdk 装配

**Files:**
- Modify: `im-client/packages/im-sdk-rn/package.json`（加依赖）
- Create: `im-client/packages/im-sdk-rn/src/adapters/axiosHttp.ts`
- Create: `im-client/packages/im-sdk-rn/src/adapters/webSocketTransport.ts`
- Create: `im-client/packages/im-sdk-rn/src/adapters/keychainSecureStore.ts`
- Create: `im-client/packages/im-sdk-rn/src/adapters/appStateLifecycle.ts`
- Create: `im-client/packages/im-sdk-rn/src/adapters/rnIds.ts`
- Create: `im-client/packages/im-sdk-rn/src/createSdk.ts`
- Modify: `im-client/packages/im-sdk-rn/src/index.ts`

**Interfaces:**
- Consumes: core 的 `Http`/`Transport`/`SecureStore`/`AppLifecycle`/`Ids`/`AuthService`/`ConnectionManager`/`ConnectionOptions`。
- Produces:
  - `AxiosHttp implements Http`（`constructor(baseURL: string, getToken: () => Promise<string | null>)`；请求拦截器加 `Authorization: Bearer`；get/post 返回 `response.data`，即后端 `Result<T>` 整体）。
  - `WebSocketTransport implements Transport`（用全局 `WebSocket`）。
  - `KeychainSecureStore implements SecureStore`（`react-native-keychain` 的 `setInternetCredentials`/`getInternetCredentials`/`resetInternetCredentials`，server=key）。
  - `AppStateLifecycle implements AppLifecycle`（RN `AppState`）。
  - `rnIds: Ids`（`uuid()` v4-ish + `now()`）。
  - `createSdk(config: { apiBaseUrl: string; wsBaseUrl: string; deviceId?: string }): { auth: AuthService; connection: ConnectionManager; ids: Ids }`。

- [ ] **Step 1: 加依赖到 `packages/im-sdk-rn/package.json`**

把 `package.json` 改为（在既有 peerDependencies 基础上加 dependencies + peerDependencies）：

```json
{
  "name": "@im/sdk-rn",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "axios": "^1.18.1"
  },
  "peerDependencies": {
    "@im/sdk-core": "*",
    "react-native": ">=0.74",
    "react-native-keychain": ">=8"
  }
}
```

- [ ] **Step 2: 写 `src/adapters/axiosHttp.ts`**

```ts
import axios, { type AxiosInstance } from 'axios';
import type { Http } from '@im/sdk-core';

export class AxiosHttp implements Http {
  private readonly client: AxiosInstance;

  constructor(baseURL: string, getToken: () => Promise<string | null>) {
    this.client = axios.create({ baseURL, timeout: 15000 });
    this.client.interceptors.request.use(async (cfg) => {
      const token = await getToken();
      if (token) {
        cfg.headers.set('Authorization', `Bearer ${token}`);
      }
      return cfg;
    });
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const res = await this.client.get<T>(path, { params });
    return res.data;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.client.post<T>(path, body);
    return res.data;
  }

  async put(url: string, body: unknown, headers?: Record<string, string>): Promise<void> {
    await this.client.put(url, body, { headers });
  }
}
```

- [ ] **Step 3: 写 `src/adapters/webSocketTransport.ts`**

```ts
import type { Transport, TransportState } from '@im/sdk-core';

/** 用 RN 全局 WebSocket 实现 Transport。只报 connected/closed，重连交给 core。 */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private stateH: (s: TransportState) => void = () => {};
  private msgH: (t: string) => void = () => {};

  connect(url: string): void {
    this.close();
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => this.stateH('connected');
    ws.onclose = () => this.stateH('closed');
    ws.onerror = () => {
      // onerror 后通常紧跟 onclose；这里不重复报状态，交给 onclose
    };
    ws.onmessage = (ev: WebSocketMessageEvent) => {
      if (typeof ev.data === 'string') this.msgH(ev.data);
    };
  }

  send(text: string): void {
    this.ws?.send(text);
  }

  onMessage(handler: (t: string) => void): void {
    this.msgH = handler;
  }

  onState(handler: (s: TransportState) => void): void {
    this.stateH = handler;
  }

  close(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
```

- [ ] **Step 4: 写 `src/adapters/keychainSecureStore.ts`**

```ts
import * as Keychain from 'react-native-keychain';
import type { SecureStore } from '@im/sdk-core';

/** 每个 key 用一条 internet credentials（server=key），互不覆盖。 */
export class KeychainSecureStore implements SecureStore {
  async get(key: string): Promise<string | null> {
    const r = await Keychain.getInternetCredentials(key);
    return r ? r.password : null;
  }

  async set(key: string, value: string): Promise<void> {
    await Keychain.setInternetCredentials(key, key, value);
  }

  async del(key: string): Promise<void> {
    await Keychain.resetInternetCredentials({ server: key });
  }
}
```

- [ ] **Step 5: 写 `src/adapters/appStateLifecycle.ts`**

```ts
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
```

- [ ] **Step 6: 写 `src/adapters/rnIds.ts`**

```ts
import type { Ids } from '@im/sdk-core';

/** clientMsgId 用途，Math.random v4 足够（不需密码学强度）。 */
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const rnIds: Ids = {
  uuid: uuidv4,
  now: () => Date.now(),
};
```

- [ ] **Step 7: 写 `src/createSdk.ts`**

```ts
import { AuthService, ConnectionManager } from '@im/sdk-core';
import { AxiosHttp } from './adapters/axiosHttp';
import { WebSocketTransport } from './adapters/webSocketTransport';
import { KeychainSecureStore } from './adapters/keychainSecureStore';
import { AppStateLifecycle } from './adapters/appStateLifecycle';
import { rnIds } from './adapters/rnIds';

export interface SdkConfig {
  apiBaseUrl: string; // 例：http://10.0.2.2:8080/api
  wsBaseUrl: string;  // 例：ws://10.0.2.2:9001/im
  deviceId?: string;
}

export function createSdk(config: SdkConfig) {
  const store = new KeychainSecureStore();
  const http = new AxiosHttp(config.apiBaseUrl, () => store.get('im.accessToken'));
  const auth = new AuthService(http, store);
  const transport = new WebSocketTransport();
  const lifecycle = new AppStateLifecycle();
  const connection = new ConnectionManager(
    transport,
    lifecycle,
    () => auth.getAccessToken(),
    { wsBaseUrl: config.wsBaseUrl, deviceId: config.deviceId ?? rnIds.uuid() },
  );
  return { auth, connection, ids: rnIds };
}
```

- [ ] **Step 8: 写 `src/index.ts`（替换占位）**

```ts
export * from './adapters/axiosHttp';
export * from './adapters/webSocketTransport';
export * from './adapters/keychainSecureStore';
export * from './adapters/appStateLifecycle';
export * from './adapters/rnIds';
export * from './createSdk';
```

- [ ] **Step 9: 提交**

```bash
git add im-client/packages/im-sdk-rn
git commit -m "feat(im-client): @im/sdk-rn 适配器（axios/WS/keychain/AppState/ids）+ createSdk 装配

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PhwtB8L5XG37b1BXGFpkQ3"
```

- [ ] **Step 10（手动验收，本地）**：`cd im-client && npm install` 应能解析 axios；`react-native`/`react-native-keychain` 作为 peer 由 app-mobile 提供（见 Task 4）。此任务无 Node 单测；正确性在 Task 4 联调时验证。

---

### Task 4: `app-mobile` RN 工程 + 登录页 + 连接状态条

**Files:**
- Create: `im-client/packages/app-mobile/**`（RN CLI 初始化生成）
- Create: `im-client/packages/app-mobile/src/sdk.ts`
- Create: `im-client/packages/app-mobile/src/store.ts`
- Create: `im-client/packages/app-mobile/src/screens/LoginScreen.tsx`
- Create: `im-client/packages/app-mobile/src/components/ConnectionStatusBar.tsx`
- Modify: `im-client/packages/app-mobile/App.tsx`

**Interfaces:**
- Consumes: `@im/sdk-rn` 的 `createSdk`。
- Produces: 可在真机/模拟器运行的最小 App：输入用户名/密码登录 → 登录成功后 `connection.start()` → 顶部状态条随 `connection.on('state')` 显示 connecting/connected/reconnecting/closed。

- [ ] **Step 1: 初始化 RN 工程（在 `im-client/packages/` 下）**

Run:
```bash
cd im-client/packages && npx @react-native-community/cli@latest init AppMobile --directory app-mobile --skip-install
```
将生成的 `app-mobile/package.json` 的 `name` 改为 `app-mobile`、加入 workspace 依赖：

```json
{
  "name": "app-mobile",
  "dependencies": {
    "@im/sdk-core": "*",
    "@im/sdk-rn": "*",
    "axios": "^1.18.1",
    "react-native-keychain": "^8.2.0",
    "zustand": "^5.0.0"
  }
}
```
然后 `cd im-client && npm install`，并 `cd packages/app-mobile/ios && pod install`（iOS）。

- [ ] **Step 2: 写 `src/sdk.ts`（单例装配）**

```ts
import { createSdk } from '@im/sdk-rn';

// Android 模拟器用 10.0.2.2 访问宿主机；iOS 模拟器用 localhost。按平台/环境改。
export const sdk = createSdk({
  apiBaseUrl: 'http://10.0.2.2:8080/api',
  wsBaseUrl: 'ws://10.0.2.2:9001/im',
  deviceId: 'rn-dev-1',
});
```

- [ ] **Step 3: 写 `src/store.ts`（Zustand：登录态 + 连接态）**

```ts
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
```

- [ ] **Step 4: 写 `src/components/ConnectionStatusBar.tsx`**

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppStore } from '../store';

const COLORS: Record<string, string> = {
  connected: '#16a34a',
  connecting: '#d97706',
  reconnecting: '#d97706',
  closed: '#dc2626',
};

const LABELS: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中…',
  reconnecting: '重连中…',
  closed: '未连接',
};

export function ConnectionStatusBar() {
  const s = useAppStore((x) => x.connState);
  return (
    <View style={[styles.bar, { backgroundColor: COLORS[s] ?? '#6b7280' }]}>
      <Text style={styles.text}>{LABELS[s] ?? s}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingVertical: 6, alignItems: 'center' },
  text: { color: '#fff', fontSize: 13 },
});
```

- [ ] **Step 5: 写 `src/screens/LoginScreen.tsx`**

```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { useAppStore } from '../store';

export function LoginScreen() {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const login = useAppStore((x) => x.login);
  const error = useAppStore((x) => x.error);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>IM 登录</Text>
      <TextInput style={styles.input} placeholder="用户名" autoCapitalize="none" value={u} onChangeText={setU} />
      <TextInput style={styles.input} placeholder="密码" secureTextEntry value={p} onChangeText={setP} />
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <Button title="登录" onPress={() => login(u, p)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12 },
  err: { color: '#dc2626' },
});
```

- [ ] **Step 6: 改 `App.tsx`**

```tsx
import React from 'react';
import { SafeAreaView, View, Text, Button, StyleSheet } from 'react-native';
import { useAppStore } from './src/store';
import { LoginScreen } from './src/screens/LoginScreen';
import { ConnectionStatusBar } from './src/components/ConnectionStatusBar';

export default function App() {
  const loggedIn = useAppStore((x) => x.loggedIn);
  const logout = useAppStore((x) => x.logout);
  return (
    <SafeAreaView style={styles.root}>
      <ConnectionStatusBar />
      {loggedIn ? (
        <View style={styles.home}>
          <Text style={styles.hi}>已登录，WS 长连接已建立。</Text>
          <Button title="登出" onPress={() => logout()} />
        </View>
      ) : (
        <LoginScreen />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  home: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  hi: { fontSize: 16 },
});
```

- [ ] **Step 7: 提交**

```bash
git add im-client/packages/app-mobile
git commit -m "feat(im-client): app-mobile RN 工程 + 登录页 + 连接状态条

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PhwtB8L5XG37b1BXGFpkQ3"
```

- [ ] **Step 8（手动验收清单，本地真机/模拟器）**：
  1. 起中间件 + 后端 + 网关：`cd deploy && docker compose --profile im --profile full up -d`；`mvn -f backend/pom.xml spring-boot:run`；`mvn -f im-gateway/pom.xml spring-boot:run`。
  2. `cd im-client/packages/app-mobile && npm run android`（或 `npm run ios`）。
  3. 输入有效 RBAC 账号 → 登录成功，状态条变「已连接」（绿）。
  4. 停掉网关进程 → 状态条变「重连中…」（橙）；重启网关 → 自动回「已连接」。
  5. App 切后台 60s+ 再回前台 → 若已断开应立即重连回「已连接」。
  6. 登出 → 状态条变「未连接」，旧连接关闭。

---

## 验收（M1 完成标志）

- Phase A：`cd im-client && npm test` 全绿（28 个测试：M0 的 15 + AuthService 6 + ConnectionManager 7）；`tsc --noEmit -p core` exit 0。
- Phase B：上述 Task 4 手动验收清单 6 步在本地全部通过（由用户在 RN 环境执行）。

## Self-Review

**1. Spec 覆盖（对照 spec M1）**：axios 复用 RBAC 登录拿 JWT → SecureStore（Task 1 + Task 3 AxiosHttp/KeychainSecureStore）✅；`ws://:9001/im?token=&deviceId=` + 心跳 + 退避重连（Task 2 + Task 3 WebSocketTransport）✅；`AppLifecycle` 回前台强制重连（Task 2 onForeground + Task 3 AppStateLifecycle）✅；UI 登录页 + 连接状态条（Task 4）✅；验收连上/断开、token 落 keychain（Phase A 测试 + Task 4 手动清单）✅。app-mobile RN 工程初始化（spec M1 备注要求）在 Task 4 ✅。
**2. 占位符扫描**：无 TBD/TODO；每个 code step 均给完整代码；Phase B 无法 Node 验证之处以「手动验收清单」明确替代，非占位。
**3. 类型一致性**：`Http`（get/post/put）签名在 Task 1 FakeHttp、Task 3 AxiosHttp 一致；`Transport`（connect/send/onMessage/onState/close）在 Task 2 FakeTransport、Task 3 WebSocketTransport 一致；`AuthService.getAccessToken` 被 createSdk 的 token 提供者与 ConnectionManager 的 `getToken` 一致消费；`ConnectionEvents` 的 `state`/`ack`/`envelope` 键在测试与 store 订阅一致；SecureStore key `im.accessToken` 在 AuthService(TOKEN_KEYS.access) 与 createSdk 的 `store.get('im.accessToken')` 一致。
