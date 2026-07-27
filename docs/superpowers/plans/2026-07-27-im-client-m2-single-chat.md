# IM 客户端 M2 · 单聊文本闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通单聊文本收发闭环——`SEND` + clientMsgId 乐观写库 → `ACK` → 自己的 `PUSH` 对账回填 → 落 SQLite；他人 `PUSH` 落库；交付选人页与会话页 UI。

**Architecture:** 未确认消息进独立 `outbox` 表（不占 `messages` 的 `(cid, seq)` 主键空间），`ChatService` 负责发送编排与下行帧路由，`SyncEngine.applyPush` 在单个事务内完成落库 + 删 outbox 对账行 + 前向单调推进会话位点。core 保持零平台依赖（Node + sql.js 单测），RN 侧新增 op-sqlite 的 `Database` 适配器。

**Tech Stack:** TypeScript（core 纯 TS）、vitest + sql.js（core 单测）、React Native 0.86、op-sqlite、React Navigation native-stack、Zustand。

**Spec:** `docs/superpowers/specs/2026-07-27-im-client-m2-single-chat-design.md`

## Global Constraints

- `im-sdk-core` **禁止** import `react` / `react-native` / `op-sqlite` / Node 内置模块；平台能力一律走 `src/ports/index.ts` 的接口注入。违反即破坏可移植性。
- core 不得依赖 DOM lib 取定时器类型；沿用 `src/globals.d.ts` 的最小 ambient 声明（M1 已建立）。
- 代码注释用简体中文，风格与现有文件一致（短句、说清"为什么"）。
- API 字段一律 camelCase；枚举用固定字符串（`SINGLE`/`GROUP`、`TEXT`、`sending`/`acked`/`failed`/`sent`）。
- 每个任务结束必须提交，提交信息前缀 `feat(im-client):` 或 `fix(im-client):`，正文写清"改了什么、为什么"。
- 分支：`feat/im`（当前分支，直接提交，不开子分支）。
- 联调参数：backend `http://<host>:8080/api`、gateway `ws://<host>:9001/im`；Android 模拟器 host = `10.0.2.2`，iOS = `localhost`；测试账号 `admin` / `admin123`。

## 验证命令速查

| 用途 | 命令 |
|------|------|
| core 单测 | `cd im-client && npm test --workspace @im/sdk-core` |
| core 单个测试文件 | `cd im-client/packages/im-sdk-core && npx vitest run test/<file>.test.ts` |
| core 类型检查 | `cd im-client && npx tsc -p packages/im-sdk-core --noEmit` |
| app-mobile 类型检查（连带 sdk-rn） | `cd im-client/packages/app-mobile && npx tsc --noEmit` |
| Android 跑起来 | `cd im-client/packages/app-mobile && npx react-native run-android` |

---

## 文件结构

**新建**
| 文件 | 职责 |
|------|------|
| `im-client/packages/im-sdk-core/src/protocol/cid.ts` | cid 拼接与解析（`buildSingleCid` / `parseCid`） |
| `im-client/packages/im-sdk-core/src/store/outboxStore.ts` | outbox 表读写 + `ChatMessage` 类型 + `mergeChatMessages` 拼接纯函数 |
| `im-client/packages/im-sdk-core/src/chat/chatService.ts` | 发送编排（写 outbox → 发帧 → ACK 超时 → 失败/重发）+ 下行帧路由 |
| `im-client/packages/im-sdk-rn/src/adapters/opSqliteDatabase.ts` | `Database` 端口的 op-sqlite 实现 |
| `im-client/packages/app-mobile/src/navigation/types.ts` | 路由参数类型 |
| `im-client/packages/app-mobile/src/screens/ContactsScreen.tsx` | 选人页（RBAC 用户列表 + 手动输入兜底） |
| `im-client/packages/app-mobile/src/screens/ChatScreen.tsx` | 会话页（inverted FlatList + 输入栏） |
| core 测试：`test/cid.test.ts`、`test/outboxStore.test.ts`、`test/chatService.test.ts` | 对应单测 |

**修改**
| 文件 | 改动 |
|------|------|
| `im-sdk-core/src/store/migrations.ts` | `MIGRATIONS` 追加 outbox 建表与索引两项 |
| `im-sdk-core/src/store/messageStore.ts` | 新增 `advanceConversation` / `advanceSyncedSeq`（MAX 前向单调语义） |
| `im-sdk-core/src/engine/syncEngine.ts` | 构造改为持 `Database`；新增 `applyPush`；`SdkEvents` 加 `sendError` |
| `im-sdk-core/src/auth/authService.ts` | 新增 `fetchMe()` + `getMyId()` |
| `im-sdk-core/src/index.ts` | 导出新增模块 |
| `im-sdk-core/test/syncEngine.test.ts` | 适配 SyncEngine 新构造签名 |
| `im-sdk-rn/src/createSdk.ts` | 装配 db/迁移/store/engine/chat，暴露 `ready` 与 `http` |
| `im-sdk-rn/package.json` | 加 op-sqlite peerDependency |
| `app-mobile/package.json` | 加 op-sqlite、React Navigation、react-native-screens |
| `app-mobile/App.tsx` | 换成 NavigationContainer + native-stack |
| `app-mobile/src/store.ts` | 加 `myId`、登录后 `fetchMe` |

---

## Task 1: cid 工具 + AuthService.fetchMe

**Files:**
- Create: `im-client/packages/im-sdk-core/src/protocol/cid.ts`
- Create: `im-client/packages/im-sdk-core/test/cid.test.ts`
- Modify: `im-client/packages/im-sdk-core/src/auth/authService.ts`
- Modify: `im-client/packages/im-sdk-core/test/authService.test.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`

**Interfaces:**
- Consumes: 现有 `Http`、`SecureStore` 端口，`ApiResult<T>`。
- Produces:
  - `buildSingleCid(a: number, b: number): string` —— 返回 `c_<min>_<max>`
  - `parseCid(cid: string): { type: 'SINGLE' | 'GROUP'; groupId: number | null }`
  - `AuthService.fetchMe(): Promise<MeData>`、`AuthService.getMyId(): number | null`
  - `interface MeData { id: number; username: string; nickname: string }`

- [ ] **Step 1: 写失败测试（cid 工具）**

新建 `test/cid.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildSingleCid, parseCid } from '../src/index';

describe('cid', () => {
  it('builds single cid with ascending user ids', () => {
    expect(buildSingleCid(2, 1)).toBe('c_1_2');
    expect(buildSingleCid(1, 2)).toBe('c_1_2');
  });

  it('parses single cid', () => {
    expect(parseCid('c_1_2')).toEqual({ type: 'SINGLE', groupId: null });
  });

  it('parses group cid', () => {
    expect(parseCid('g_77')).toEqual({ type: 'GROUP', groupId: 77 });
  });

  it('treats unknown shape as SINGLE without group id', () => {
    expect(parseCid('weird')).toEqual({ type: 'SINGLE', groupId: null });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd im-client/packages/im-sdk-core && npx vitest run test/cid.test.ts`
Expected: FAIL —— `buildSingleCid` 不是导出成员。

- [ ] **Step 3: 实现 cid 工具**

新建 `src/protocol/cid.ts`：

```ts
/** 单聊 cid：两个用户 id 升序拼接（对齐接口文档 §2.3）。 */
export function buildSingleCid(a: number, b: number): string {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return `c_${min}_${max}`;
}

/** 从 cid 反推会话类型与群 id；形态不认识时按单聊处理，不抛异常。 */
export function parseCid(cid: string): {
  type: 'SINGLE' | 'GROUP';
  groupId: number | null;
} {
  if (cid.startsWith('g_')) {
    const n = Number(cid.slice(2));
    return { type: 'GROUP', groupId: Number.isFinite(n) ? n : null };
  }
  return { type: 'SINGLE', groupId: null };
}
```

在 `src/index.ts` 的 `export * from './protocol/types';` 之后加一行：

```ts
export * from './protocol/cid';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd im-client/packages/im-sdk-core && npx vitest run test/cid.test.ts`
Expected: PASS 4/4

- [ ] **Step 5: 写失败测试（fetchMe）**

在 `test/authService.test.ts` 末尾追加（该文件已有 `FakeHttp`/`FakeStore` 之类的假实现，沿用文件里已有的命名；若假 Http 尚未支持记录 GET，按下面写法补上 `get`）：

```ts
describe('AuthService.fetchMe', () => {
  it('fetches current user and caches the id', async () => {
    const http = {
      async get<T>(path: string): Promise<T> {
        expect(path).toBe('/auth/me');
        return {
          code: 200,
          message: 'success',
          data: { id: 7, username: 'admin', nickname: '管理员' },
        } as T;
      },
      async post<T>(): Promise<T> {
        throw new Error('not used');
      },
      async put(): Promise<void> {},
    };
    const store = {
      map: new Map<string, string>(),
      async get(k: string) {
        return this.map.get(k) ?? null;
      },
      async set(k: string, v: string) {
        this.map.set(k, v);
      },
      async del(k: string) {
        this.map.delete(k);
      },
    };

    const auth = new AuthService(http, store);
    expect(auth.getMyId()).toBeNull();

    const me = await auth.fetchMe();
    expect(me.id).toBe(7);
    expect(auth.getMyId()).toBe(7);
  });

  it('clears cached id on logout', async () => {
    const http = {
      async get<T>(): Promise<T> {
        return {
          code: 200,
          message: 'success',
          data: { id: 7, username: 'admin', nickname: '管理员' },
        } as T;
      },
      async post<T>(): Promise<T> {
        return { code: 200, message: 'success', data: null } as T;
      },
      async put(): Promise<void> {},
    };
    const store = {
      map: new Map<string, string>(),
      async get(k: string) {
        return this.map.get(k) ?? null;
      },
      async set(k: string, v: string) {
        this.map.set(k, v);
      },
      async del(k: string) {
        this.map.delete(k);
      },
    };

    const auth = new AuthService(http, store);
    await auth.fetchMe();
    await auth.logout();
    expect(auth.getMyId()).toBeNull();
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd im-client/packages/im-sdk-core && npx vitest run test/authService.test.ts`
Expected: FAIL —— `auth.fetchMe is not a function`

- [ ] **Step 7: 实现 fetchMe**

在 `src/auth/authService.ts` 里，`LoginData` 之后加类型：

```ts
export interface MeData {
  id: number;
  username: string;
  nickname: string;
}
```

在 `AuthService` 类里加字段与方法：

```ts
  private myId: number | null = null;

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
```

并在 `logout()` 清空本地 token 的同时清缓存——在 `await this.store.del(TOKEN_KEYS.refresh);` 之后加：

```ts
    this.myId = null;
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd im-client/packages/im-sdk-core && npx vitest run` 且 `cd im-client && npx tsc -p packages/im-sdk-core --noEmit`
Expected: 全部 PASS；tsc exit 0

- [ ] **Step 9: 提交**

```bash
cd /Users/xxmm/work/RBAC-Server
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): core cid 工具 + AuthService.fetchMe（M2 Task1）"
```

---

## Task 2: outbox 迁移 + OutboxStore + 读路径拼接

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/store/migrations.ts`
- Create: `im-client/packages/im-sdk-core/src/store/outboxStore.ts`
- Create: `im-client/packages/im-sdk-core/test/outboxStore.test.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`

**Interfaces:**
- Consumes: `Database`、`Row`（`src/ports/index.ts`）、`StoredMessage`（`src/store/messageStore.ts`）。
- Produces:
  - `type ChatStatus = 'sent' | 'sending' | 'acked' | 'failed'`
  - `interface OutboxRow { clientMsgId: string; cid: string; type: string; body: Record<string, unknown> | null; status: ChatStatus; error: string | null; createdAt: number }`
  - `interface ChatMessage { cid; seq: number | null; clientMsgId: string | null; msgId: string | null; senderId: number | null; type: string; body: Record<string, unknown> | null; recalled: boolean; status: ChatStatus; error: string | null; ts: number }`
  - `class OutboxStore { insert(row); get(clientMsgId): Promise<OutboxRow | null>; listByCid(cid): Promise<OutboxRow[]>; setStatus(clientMsgId, status, error); setStatusWhere(clientMsgId, from, to, error); delete(clientMsgId) }`
  - `function mergeChatMessages(messages: StoredMessage[], pending: OutboxRow[]): ChatMessage[]`

- [ ] **Step 1: 写失败测试**

新建 `test/outboxStore.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  MessageStore,
  OutboxStore,
  mergeChatMessages,
  runMigrations,
  type OutboxRow,
  type StoredMessage,
} from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    clientMsgId: 'cmid-1',
    cid: 'c_1_2',
    type: 'TEXT',
    body: { text: 'hi' },
    status: 'sending',
    error: null,
    createdAt: 1000,
    ...over,
  };
}

function stored(over: Partial<StoredMessage> = {}): StoredMessage {
  return {
    cid: 'c_1_2',
    seq: 1,
    msgId: 'm1',
    clientMsgId: null,
    senderId: 2,
    type: 'TEXT',
    body: { text: 'from peer' },
    recalled: false,
    status: 'sent',
    ts: 900,
    ...over,
  };
}

async function freshDb() {
  const db = await createSqljsDatabase();
  await runMigrations(db);
  return db;
}

describe('OutboxStore', () => {
  it('creates the outbox table via migrations and is idempotent', async () => {
    const db = await freshDb();
    await runMigrations(db); // 重复调用不得报错
    const rows = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='outbox'`,
    );
    expect(rows.length).toBe(1);
  });

  it('inserts and reads back a row', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row());
    const got = await outbox.get('cmid-1');
    expect(got).not.toBeNull();
    expect(got!.cid).toBe('c_1_2');
    expect(got!.body).toEqual({ text: 'hi' });
    expect(got!.status).toBe('sending');
    expect(got!.createdAt).toBe(1000);
  });

  it('returns null for an unknown clientMsgId', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    expect(await outbox.get('nope')).toBeNull();
  });

  it('setStatus overwrites status and error', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row());
    await outbox.setStatus('cmid-1', 'failed', 'NOT_MEMBER');
    const got = await outbox.get('cmid-1');
    expect(got!.status).toBe('failed');
    expect(got!.error).toBe('NOT_MEMBER');
  });

  it('setStatusWhere only applies when the current status matches', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row());
    await outbox.setStatus('cmid-1', 'acked', null);

    // 想从 sending 改成 failed，但当前已是 acked —— 不应生效
    await outbox.setStatusWhere('cmid-1', 'sending', 'failed', 'ACK_TIMEOUT');
    expect((await outbox.get('cmid-1'))!.status).toBe('acked');

    // 条件匹配时生效
    await outbox.setStatusWhere('cmid-1', 'acked', 'failed', 'ACK_TIMEOUT');
    const got = await outbox.get('cmid-1');
    expect(got!.status).toBe('failed');
    expect(got!.error).toBe('ACK_TIMEOUT');
  });

  it('deletes a row', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row());
    await outbox.delete('cmid-1');
    expect(await outbox.get('cmid-1')).toBeNull();
  });

  it('lists rows of one cid ordered by created_at', async () => {
    const db = await freshDb();
    const outbox = new OutboxStore(db);
    await outbox.insert(row({ clientMsgId: 'b', createdAt: 2000 }));
    await outbox.insert(row({ clientMsgId: 'a', createdAt: 1000 }));
    await outbox.insert(row({ clientMsgId: 'other', cid: 'c_3_4', createdAt: 500 }));
    const list = await outbox.listByCid('c_1_2');
    expect(list.map((r) => r.clientMsgId)).toEqual(['a', 'b']);
  });
});

describe('mergeChatMessages', () => {
  it('puts persisted messages first and pending ones last', () => {
    const merged = mergeChatMessages(
      [stored({ seq: 1, ts: 900 }), stored({ seq: 2, msgId: 'm2', ts: 950 })],
      [row({ clientMsgId: 'p1', createdAt: 1000 })],
    );
    expect(merged.map((m) => m.seq)).toEqual([1, 2, null]);
    expect(merged[2].clientMsgId).toBe('p1');
    expect(merged[2].status).toBe('sending');
    expect(merged[2].senderId).toBeNull();
    expect(merged[2].ts).toBe(1000);
  });

  it('maps persisted rows into ChatMessage shape', () => {
    const merged = mergeChatMessages([stored()], []);
    expect(merged[0]).toEqual({
      cid: 'c_1_2',
      seq: 1,
      clientMsgId: null,
      msgId: 'm1',
      senderId: 2,
      type: 'TEXT',
      body: { text: 'from peer' },
      recalled: false,
      status: 'sent',
      error: null,
      ts: 900,
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd im-client/packages/im-sdk-core && npx vitest run test/outboxStore.test.ts`
Expected: FAIL —— `OutboxStore` 不是导出成员。

- [ ] **Step 3: 加迁移**

在 `src/store/migrations.ts` 的 `MIGRATIONS` 数组末尾追加两项（**必须追加在末尾**，版本号 = 数组下标，插到中间会让老库版本号错位）：

```ts
  `CREATE TABLE outbox (
     client_msg_id TEXT PRIMARY KEY,
     cid TEXT NOT NULL,
     type TEXT NOT NULL,
     body_json TEXT,
     status TEXT NOT NULL,
     error TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX idx_outbox_cid_created ON outbox (cid, created_at)`,
```

- [ ] **Step 4: 实现 OutboxStore 与 mergeChatMessages**

新建 `src/store/outboxStore.ts`：

```ts
import type { Database, Row } from '../ports/index';
import type { StoredMessage } from './messageStore';

export type ChatStatus = 'sent' | 'sending' | 'acked' | 'failed';

/** 待确认消息：还没拿到服务端 seq，不能进 messages(cid, seq)。 */
export interface OutboxRow {
  clientMsgId: string;
  cid: string;
  type: string;
  body: Record<string, unknown> | null;
  status: ChatStatus;
  error: string | null;
  createdAt: number;
}

/** UI 统一视图：seq 为 null 即仍在 outbox。 */
export interface ChatMessage {
  cid: string;
  seq: number | null;
  clientMsgId: string | null;
  msgId: string | null;
  senderId: number | null;
  type: string;
  body: Record<string, unknown> | null;
  recalled: boolean;
  status: ChatStatus;
  error: string | null;
  ts: number;
}

function toRow(r: Row): OutboxRow {
  return {
    clientMsgId: r.client_msg_id as string,
    cid: r.cid as string,
    type: r.type as string,
    body: r.body_json == null ? null : (JSON.parse(r.body_json as string) as Record<string, unknown>),
    status: r.status as ChatStatus,
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as number,
  };
}

export class OutboxStore {
  constructor(private readonly db: Database) {}

  async insert(row: OutboxRow): Promise<void> {
    await this.db.exec(
      `INSERT INTO outbox (client_msg_id, cid, type, body_json, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.clientMsgId,
        row.cid,
        row.type,
        row.body === null ? null : JSON.stringify(row.body),
        row.status,
        row.error,
        row.createdAt,
      ],
    );
  }

  async get(clientMsgId: string): Promise<OutboxRow | null> {
    const rows = await this.db.query<Row>(
      `SELECT client_msg_id, cid, type, body_json, status, error, created_at
         FROM outbox WHERE client_msg_id = ?`,
      [clientMsgId],
    );
    return rows.length ? toRow(rows[0]) : null;
  }

  async listByCid(cid: string): Promise<OutboxRow[]> {
    const rows = await this.db.query<Row>(
      `SELECT client_msg_id, cid, type, body_json, status, error, created_at
         FROM outbox WHERE cid = ? ORDER BY created_at ASC`,
      [cid],
    );
    return rows.map(toRow);
  }

  async setStatus(clientMsgId: string, status: ChatStatus, error: string | null): Promise<void> {
    await this.db.exec(`UPDATE outbox SET status = ?, error = ? WHERE client_msg_id = ?`, [
      status,
      error,
      clientMsgId,
    ]);
  }

  /** 条件更新：只有当前状态等于 from 才改。天然处理 ACK/超时/PUSH 三者的到达竞争。 */
  async setStatusWhere(
    clientMsgId: string,
    from: ChatStatus,
    to: ChatStatus,
    error: string | null,
  ): Promise<void> {
    await this.db.exec(
      `UPDATE outbox SET status = ?, error = ? WHERE client_msg_id = ? AND status = ?`,
      [to, error, clientMsgId, from],
    );
  }

  async delete(clientMsgId: string): Promise<void> {
    await this.db.exec(`DELETE FROM outbox WHERE client_msg_id = ?`, [clientMsgId]);
  }
}

/** 已落库消息（seq ASC）在前，待发消息（created_at ASC）在后 —— 天然就是正确时间序。 */
export function mergeChatMessages(
  messages: StoredMessage[],
  pending: OutboxRow[],
): ChatMessage[] {
  const persisted: ChatMessage[] = messages.map((m) => ({
    cid: m.cid,
    seq: m.seq,
    clientMsgId: m.clientMsgId,
    msgId: m.msgId,
    senderId: m.senderId,
    type: m.type,
    body: m.body,
    recalled: m.recalled,
    status: 'sent',
    error: null,
    ts: m.ts,
  }));
  const waiting: ChatMessage[] = pending.map((p) => ({
    cid: p.cid,
    seq: null,
    clientMsgId: p.clientMsgId,
    msgId: null,
    senderId: null, // 待发消息必然是本机发的，UI 按 seq == null 判己方
    type: p.type,
    body: p.body,
    recalled: false,
    status: p.status,
    error: p.error,
    ts: p.createdAt,
  }));
  return [...persisted, ...waiting];
}
```

在 `src/index.ts` 的 `export * from './store/messageStore';` 之后加：

```ts
export * from './store/outboxStore';
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd im-client/packages/im-sdk-core && npx vitest run`
Expected: 全部 PASS（含既有测试；`migrations.test.ts` 若断言了迁移条数，同步更新为新条数）

- [ ] **Step 6: 类型检查**

Run: `cd im-client && npx tsc -p packages/im-sdk-core --noEmit`
Expected: exit 0

- [ ] **Step 7: 提交**

```bash
cd /Users/xxmm/work/RBAC-Server
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): outbox 表迁移 + OutboxStore + 读路径拼接（M2 Task2）"
```

---

## Task 3: 位点前向单调 + SyncEngine.applyPush

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/store/messageStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`
- Modify: `im-client/packages/im-sdk-core/test/syncEngine.test.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`（如需导出新类型）

**Interfaces:**
- Consumes: Task 1 的 `parseCid`，Task 2 的 `OutboxStore`。
- Produces:
  - `MessageStore.advanceConversation(c: { cid: string; type: string; groupId: number | null; seq: number; preview: string | null }): Promise<void>` —— last_msg_seq 取 MAX，preview 仅在 seq 更大时更新
  - `MessageStore.advanceSyncedSeq(cid: string, seq: number): Promise<void>` —— synced_seq 取 MAX
  - `SyncEngine` 构造签名改为 `new SyncEngine(db: Database, emitter: Emitter<SdkEvents>)`
  - `SyncEngine.applyPush(env: Envelope): Promise<void>`
  - `SdkEvents` 增加 `sendError: { cid: string; clientMsgId: string; reason: string }`

- [ ] **Step 1: 写失败测试**

把 `test/syncEngine.test.ts` 整个替换为：

```ts
import { describe, it, expect } from 'vitest';
import {
  Emitter,
  MessageStore,
  OutboxStore,
  SyncEngine,
  runMigrations,
  type Envelope,
  type SdkEvents,
} from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

function push(over: Partial<Envelope> = {}): Envelope {
  return {
    op: 'PUSH',
    cid: 'c_1_2',
    seq: 10,
    msgId: 'm10',
    senderId: 2,
    type: 'TEXT',
    body: { text: 'hello' },
    ts: 1000,
    ...over,
  };
}

async function setup() {
  const db = await createSqljsDatabase();
  await runMigrations(db);
  const emitter = new Emitter<SdkEvents>();
  const engine = new SyncEngine(db, emitter);
  return { db, emitter, engine, messages: new MessageStore(db), outbox: new OutboxStore(db) };
}

describe('SyncEngine.applyPush', () => {
  it('persists a peer message and emits message + conversation', async () => {
    const { engine, emitter, messages } = await setup();
    const seen: string[] = [];
    emitter.on('message', (p) => seen.push(`m:${p.cid}`));
    emitter.on('conversation', (p) => seen.push(`c:${p.cid}`));

    await engine.applyPush(push());

    const rows = await messages.getMessages('c_1_2');
    expect(rows.length).toBe(1);
    expect(rows[0].seq).toBe(10);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].body).toEqual({ text: 'hello' });
    expect(seen).toEqual(['m:c_1_2', 'c:c_1_2']);
  });

  it('reconciles own message: inserts row and removes the outbox entry', async () => {
    const { engine, messages, outbox } = await setup();
    await outbox.insert({
      clientMsgId: 'cmid-9',
      cid: 'c_1_2',
      type: 'TEXT',
      body: { text: 'hello' },
      status: 'acked',
      error: null,
      createdAt: 500,
    });

    await engine.applyPush(push({ clientMsgId: 'cmid-9', senderId: 1 }));

    expect(await outbox.get('cmid-9')).toBeNull();
    const rows = await messages.getMessages('c_1_2');
    expect(rows.length).toBe(1);
    expect(rows[0].clientMsgId).toBe('cmid-9');
  });

  it('is idempotent for a repeated (cid, seq)', async () => {
    const { engine, messages } = await setup();
    await engine.applyPush(push());
    await engine.applyPush(push());
    expect((await messages.getMessages('c_1_2')).length).toBe(1);
  });

  it('does not roll back conversation/sync positions on out-of-order arrival', async () => {
    const { engine, messages, db } = await setup();
    await engine.applyPush(push({ seq: 43, msgId: 'm43' }));
    await engine.applyPush(push({ seq: 42, msgId: 'm42', body: { text: 'older' } }));

    const convs = await db.query<{ last_msg_seq: number; last_msg_preview: string }>(
      `SELECT last_msg_seq, last_msg_preview FROM conversations WHERE cid = 'c_1_2'`,
    );
    expect(convs[0].last_msg_seq).toBe(43);
    expect(convs[0].last_msg_preview).toBe('hello'); // 旧消息不得覆盖预览
    expect(await messages.getSyncedSeq('c_1_2')).toBe(43);
    expect((await messages.getMessages('c_1_2')).length).toBe(2);
  });

  it('drops frames without cid or seq', async () => {
    const { engine, emitter, messages } = await setup();
    let events = 0;
    emitter.on('message', () => (events += 1));

    await engine.applyPush({ op: 'PUSH', seq: 1 } as Envelope);
    await engine.applyPush({ op: 'PUSH', cid: 'c_1_2' } as Envelope);

    expect((await messages.getMessages('c_1_2')).length).toBe(0);
    expect(events).toBe(0);
  });

  it('records group conversation type from the cid', async () => {
    const { engine, db } = await setup();
    await engine.applyPush(push({ cid: 'g_77' }));
    const convs = await db.query<{ type: string; group_id: number }>(
      `SELECT type, group_id FROM conversations WHERE cid = 'g_77'`,
    );
    expect(convs[0].type).toBe('GROUP');
    expect(convs[0].group_id).toBe(77);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd im-client/packages/im-sdk-core && npx vitest run test/syncEngine.test.ts`
Expected: FAIL —— `SyncEngine` 构造签名不符 / `applyPush` 不存在。

- [ ] **Step 3: 给 MessageStore 加前向单调方法**

在 `src/store/messageStore.ts` 的 `MessageStore` 类中追加（保留现有 `upsertConversation`/`setSyncedSeq` 不动）：

```ts
  /** 会话位点只增不减；预览仅在 seq 更大时才更新，乱序到达的旧消息不得覆盖。 */
  async advanceConversation(c: {
    cid: string;
    type: string;
    groupId: number | null;
    seq: number;
    preview: string | null;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO conversations (cid, type, group_id, last_msg_seq, last_msg_preview, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid) DO UPDATE SET
         last_msg_preview = CASE WHEN excluded.last_msg_seq > conversations.last_msg_seq
                                 THEN excluded.last_msg_preview
                                 ELSE conversations.last_msg_preview END,
         last_msg_seq = MAX(conversations.last_msg_seq, excluded.last_msg_seq),
         updated_at = excluded.updated_at`,
      [c.cid, c.type, c.groupId, c.seq, c.preview, Date.now()],
    );
  }

  /** 同步位点前向单调推进（M3 增量拉取的起点）。 */
  async advanceSyncedSeq(cid: string, seq: number): Promise<void> {
    await this.db.exec(
      `INSERT INTO sync_meta (cid, synced_seq) VALUES (?, ?)
       ON CONFLICT(cid) DO UPDATE SET synced_seq = MAX(sync_meta.synced_seq, excluded.synced_seq)`,
      [cid, seq],
    );
  }
```

- [ ] **Step 4: 重写 SyncEngine**

把 `src/engine/syncEngine.ts` 整个替换为：

```ts
import type { Emitter } from '../events/emitter';
import { MessageStore, type StoredMessage } from '../store/messageStore';
import { OutboxStore } from '../store/outboxStore';
import { parseCid } from '../protocol/cid';
import type { Envelope } from '../protocol/types';
import type { Database } from '../ports/index';

export interface SdkEvents extends Record<string, unknown> {
  message: { cid: string };
  conversation: { cid: string };
  sendError: { cid: string; clientMsgId: string; reason: string };
}

/** 会话列表用的一行摘要文案；正文过长时截断。 */
export function previewOf(type: string | undefined, body: Record<string, unknown> | null): string {
  switch (type) {
    case 'TEXT':
    case 'SYSTEM': {
      const text = typeof body?.text === 'string' ? body.text : '';
      return text.length > 50 ? `${text.slice(0, 50)}…` : text;
    }
    case 'IMAGE':
      return '[图片]';
    case 'AUDIO':
      return '[语音]';
    case 'FILE':
      return '[文件]';
    case 'RECALL':
      return '[消息已撤回]';
    default:
      return '';
  }
}

/**
 * 同步引擎：SQLite 单一事实源的写入口。
 * WS PUSH 与（M3 的）REST 拉取都归到 applyPush 这一条路径，保证去重/位点语义只有一份。
 */
export class SyncEngine {
  private readonly store: MessageStore;

  constructor(
    private readonly db: Database,
    private readonly emitter: Emitter<SdkEvents>,
  ) {
    this.store = new MessageStore(db);
  }

  async applyIncoming(m: StoredMessage): Promise<void> {
    await this.store.upsertMessage(m);
    this.emitter.emit('message', { cid: m.cid });
    this.emitter.emit('conversation', { cid: m.cid });
  }

  /** 落库 + 发送对账 + 位点推进，全部在一个事务内；脏帧直接丢弃不炸线程。 */
  async applyPush(env: Envelope): Promise<void> {
    const cid = env.cid;
    const seq = env.seq;
    if (typeof cid !== 'string' || cid === '') return;
    if (typeof seq !== 'number' || !Number.isFinite(seq)) return;

    const body = (env.body ?? null) as Record<string, unknown> | null;
    const stored: StoredMessage = {
      cid,
      seq,
      msgId: env.msgId ?? null,
      clientMsgId: env.clientMsgId ?? null,
      senderId: env.senderId ?? null,
      type: env.type ?? 'TEXT',
      body,
      recalled: false,
      status: 'sent',
      ts: env.ts ?? 0,
    };
    const { type, groupId } = parseCid(cid);

    await this.db.tx(async (tx) => {
      const messages = new MessageStore(tx);
      await messages.upsertMessage(stored);
      if (env.clientMsgId) {
        await new OutboxStore(tx).delete(env.clientMsgId);
      }
      await messages.advanceConversation({
        cid,
        type,
        groupId,
        seq,
        preview: previewOf(stored.type, body),
      });
      await messages.advanceSyncedSeq(cid, seq);
    });

    this.emitter.emit('message', { cid });
    this.emitter.emit('conversation', { cid });
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd im-client/packages/im-sdk-core && npx vitest run`
Expected: 全部 PASS（6 条新增 applyPush 用例 + 既有用例）

- [ ] **Step 6: 类型检查**

Run: `cd im-client && npx tsc -p packages/im-sdk-core --noEmit`
Expected: exit 0

- [ ] **Step 7: 提交**

```bash
cd /Users/xxmm/work/RBAC-Server
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): SyncEngine.applyPush 事务落库+对账+位点前向单调（M2 Task3）"
```

---

## Task 4: ChatService 发送编排与下行帧路由

**Files:**
- Create: `im-client/packages/im-sdk-core/src/chat/chatService.ts`
- Create: `im-client/packages/im-sdk-core/test/chatService.test.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`

**Interfaces:**
- Consumes: `ConnectionManager`（`on('ack')` / `on('envelope')` / `getState()` / `send()`）、Task 2 的 `OutboxStore`/`ChatMessage`/`mergeChatMessages`、Task 3 的 `SyncEngine`/`SdkEvents`、`Ids` 端口、`OP`。
- Produces:
  - `class ChatService { sendText(cid, text): Promise<string>; resend(clientMsgId): Promise<void>; getChatMessages(cid): Promise<ChatMessage[]>; on<K extends keyof SdkEvents>(key, fn): () => void; stop(): void }`
  - `interface ChatOptions { ackTimeoutMs?: number }`（默认 15000）

- [ ] **Step 1: 写失败测试**

新建 `test/chatService.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ChatService,
  ConnectionManager,
  Emitter,
  MessageStore,
  OutboxStore,
  SyncEngine,
  runMigrations,
  type AppLifecycle,
  type Database,
  type Ids,
  type SdkEvents,
  type Transport,
  type TransportState,
} from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

class FakeTransport implements Transport {
  sent: string[] = [];
  private stateH?: (s: TransportState) => void;
  private msgH?: (t: string) => void;
  connect() {}
  send(t: string) { this.sent.push(t); }
  onMessage(h: (t: string) => void) { this.msgH = h; }
  onState(h: (s: TransportState) => void) { this.stateH = h; }
  close() { this.stateH?.('closed'); }
  emitState(s: TransportState) { this.stateH?.(s); }
  emitMessage(t: string) { this.msgH?.(t); }
}

class FakeLifecycle implements AppLifecycle {
  onForeground() {}
  onBackground() {}
}

const ids: Ids = (() => {
  let n = 0;
  return {
    uuid: () => `cmid-${++n}`,
    now: () => 1000 + n,
  };
})();

interface Ctx {
  db: Database;
  transport: FakeTransport;
  connection: ConnectionManager;
  chat: ChatService;
  outbox: OutboxStore;
  messages: MessageStore;
  emitter: Emitter<SdkEvents>;
}

async function setup(connected = true): Promise<Ctx> {
  const db = await createSqljsDatabase();
  await runMigrations(db);
  const transport = new FakeTransport();
  const connection = new ConnectionManager(
    transport,
    new FakeLifecycle(),
    async () => 'tok',
    { wsBaseUrl: 'ws://x/im', deviceId: 'd1', random: () => 0 },
  );
  await connection.start();
  if (connected) transport.emitState('connected');

  const emitter = new Emitter<SdkEvents>();
  const engine = new SyncEngine(db, emitter);
  const outbox = new OutboxStore(db);
  const chat = new ChatService(connection, engine, new MessageStore(db), outbox, ids, emitter, {
    ackTimeoutMs: 15000,
  });
  return { db, transport, connection, chat, outbox, messages: new MessageStore(db), emitter };
}

describe('ChatService.sendText', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes an outbox row and emits a SEND frame', async () => {
    const { chat, outbox, transport } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    const row = await outbox.get(cmid);
    expect(row!.status).toBe('sending');
    expect(row!.body).toEqual({ text: 'hi' });

    const frames = transport.sent.map((s) => JSON.parse(s));
    const send = frames.find((f) => f.op === 'SEND');
    expect(send).toMatchObject({
      op: 'SEND',
      cid: 'c_1_2',
      clientMsgId: cmid,
      type: 'TEXT',
      body: { text: 'hi' },
    });
  });

  it('fails immediately with OFFLINE when not connected, without sending a frame', async () => {
    const { chat, outbox, transport } = await setup(false);
    const errors: string[] = [];
    chat.on('sendError', (p) => errors.push(p.reason));

    const cmid = await chat.sendText('c_1_2', 'hi');

    const row = await outbox.get(cmid);
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('OFFLINE');
    expect(transport.sent.filter((s) => JSON.parse(s).op === 'SEND')).toHaveLength(0);
    expect(errors).toEqual(['OFFLINE']);
  });

  it('marks the row acked when the ACK frame arrives', async () => {
    const { chat, outbox, transport } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    transport.emitMessage(JSON.stringify({ op: 'ACK', clientMsgId: cmid }));
    await vi.advanceTimersByTimeAsync(0);

    expect((await outbox.get(cmid))!.status).toBe('acked');
  });

  it('fails the row with ACK_TIMEOUT when no ACK arrives in time', async () => {
    const { chat, outbox } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    await vi.advanceTimersByTimeAsync(15000);

    const row = await outbox.get(cmid);
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('ACK_TIMEOUT');
  });

  it('does not overwrite an acked row when the timeout fires late', async () => {
    const { chat, outbox, transport } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    transport.emitMessage(JSON.stringify({ op: 'ACK', clientMsgId: cmid }));
    await vi.advanceTimersByTimeAsync(20000);

    expect((await outbox.get(cmid))!.status).toBe('acked');
  });

  it('marks the row failed with the reason from an ERROR frame', async () => {
    const { chat, outbox, transport } = await setup();
    const errors: Array<{ clientMsgId: string; reason: string }> = [];
    chat.on('sendError', (p) => errors.push({ clientMsgId: p.clientMsgId, reason: p.reason }));

    const cmid = await chat.sendText('c_1_2', 'hi');
    transport.emitMessage(
      JSON.stringify({ op: 'ERROR', cid: 'c_1_2', clientMsgId: cmid, body: { reason: 'NOT_MEMBER' } }),
    );
    await vi.advanceTimersByTimeAsync(0);

    const row = await outbox.get(cmid);
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('NOT_MEMBER');
    expect(errors).toEqual([{ clientMsgId: cmid, reason: 'NOT_MEMBER' }]);
  });
});

describe('ChatService.resend', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-sends with the same clientMsgId', async () => {
    const { chat, outbox, transport } = await setup(false);
    const cmid = await chat.sendText('c_1_2', 'hi'); // OFFLINE 失败

    transport.emitState('connected');
    await chat.resend(cmid);

    const sends = transport.sent.map((s) => JSON.parse(s)).filter((f) => f.op === 'SEND');
    expect(sends).toHaveLength(1);
    expect(sends[0].clientMsgId).toBe(cmid);
    expect((await outbox.get(cmid))!.status).toBe('sending');
  });

  it('ignores an unknown clientMsgId', async () => {
    const { chat } = await setup();
    await expect(chat.resend('nope')).resolves.toBeUndefined();
  });
});

describe('ChatService downstream routing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('routes PUSH into the engine and reconciles the outbox row', async () => {
    const { chat, outbox, transport, messages } = await setup();
    const cmid = await chat.sendText('c_1_2', 'hi');

    transport.emitMessage(
      JSON.stringify({
        op: 'PUSH',
        cid: 'c_1_2',
        seq: 11,
        msgId: 'm11',
        senderId: 1,
        clientMsgId: cmid,
        type: 'TEXT',
        body: { text: 'hi' },
        ts: 1234,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(await outbox.get(cmid)).toBeNull();
    const rows = await messages.getMessages('c_1_2');
    expect(rows).toHaveLength(1);
    expect(rows[0].seq).toBe(11);
  });
});

describe('ChatService.getChatMessages', () => {
  it('returns persisted messages first and pending ones last', async () => {
    const { chat, messages } = await setup(false);
    await messages.upsertMessage({
      cid: 'c_1_2',
      seq: 5,
      msgId: 'm5',
      clientMsgId: null,
      senderId: 2,
      type: 'TEXT',
      body: { text: 'peer' },
      recalled: false,
      status: 'sent',
      ts: 100,
    });
    const cmid = await chat.sendText('c_1_2', 'mine');

    const list = await chat.getChatMessages('c_1_2');
    expect(list.map((m) => m.seq)).toEqual([5, null]);
    expect(list[1].clientMsgId).toBe(cmid);
    expect(list[1].status).toBe('failed'); // 未连接 → OFFLINE
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd im-client/packages/im-sdk-core && npx vitest run test/chatService.test.ts`
Expected: FAIL —— `ChatService` 不是导出成员。

- [ ] **Step 3: 实现 ChatService**

新建 `src/chat/chatService.ts`：

```ts
import type { Emitter } from '../events/emitter';
import type { ConnectionManager } from '../connection/connectionManager';
import type { SdkEvents, SyncEngine } from '../engine/syncEngine';
import type { MessageStore } from '../store/messageStore';
import {
  mergeChatMessages,
  type ChatMessage,
  type OutboxRow,
  type OutboxStore,
} from '../store/outboxStore';
import { OP, type Envelope, type MessageType } from '../protocol/types';
import type { Ids } from '../ports/index';

export interface ChatOptions {
  /** 发出 SEND 后多久没收到 ACK 就判失败（毫秒） */
  ackTimeoutMs?: number;
}

const DEFAULT_ACK_TIMEOUT_MS = 15000;

/**
 * 发送编排 + 下行帧路由。
 * 发送即以 clientMsgId 乐观写 outbox；ACK 表示网关受理；自己的 PUSH 到达才算最终落定。
 */
export class ChatService {
  private readonly ackTimeoutMs: number;
  private readonly ackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly connection: ConnectionManager,
    private readonly engine: SyncEngine,
    private readonly messages: MessageStore,
    private readonly outbox: OutboxStore,
    private readonly ids: Ids,
    private readonly emitter: Emitter<SdkEvents>,
    opts: ChatOptions = {},
  ) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.connection.on('ack', ({ clientMsgId }) => void this.onAck(clientMsgId));
    this.connection.on('envelope', (env) => void this.onEnvelope(env));
  }

  on<K extends keyof SdkEvents>(key: K, fn: (payload: SdkEvents[K]) => void): () => void {
    return this.emitter.on(key, fn);
  }

  /** 返回 clientMsgId，供 UI 关联气泡与重发。 */
  async sendText(cid: string, text: string): Promise<string> {
    const row: OutboxRow = {
      clientMsgId: this.ids.uuid(),
      cid,
      type: 'TEXT',
      body: { text },
      status: 'sending',
      error: null,
      createdAt: this.ids.now(),
    };
    await this.outbox.insert(row);
    this.emitter.emit('message', { cid });
    await this.dispatch(row);
    return row.clientMsgId;
  }

  /** 复用同一 clientMsgId 重发；服务端对 clientMsgId 幂等，不会产生重复消息。 */
  async resend(clientMsgId: string): Promise<void> {
    const row = await this.outbox.get(clientMsgId);
    if (row == null) return;
    await this.outbox.setStatus(clientMsgId, 'sending', null);
    this.emitter.emit('message', { cid: row.cid });
    await this.dispatch({ ...row, status: 'sending', error: null });
  }

  async getChatMessages(cid: string): Promise<ChatMessage[]> {
    const [persisted, pending] = await Promise.all([
      this.messages.getMessages(cid),
      this.outbox.listByCid(cid),
    ]);
    return mergeChatMessages(persisted, pending);
  }

  /** 释放全部待处理计时器（登出 / 卸载时调用）。 */
  stop(): void {
    this.ackTimers.forEach((t) => clearTimeout(t));
    this.ackTimers.clear();
  }

  private async dispatch(row: OutboxRow): Promise<void> {
    if (this.connection.getState() !== 'connected') {
      await this.fail(row.cid, row.clientMsgId, 'OFFLINE');
      return;
    }
    this.connection.send({
      op: OP.SEND,
      cid: row.cid,
      clientMsgId: row.clientMsgId,
      type: row.type as MessageType,
      body: row.body ?? {},
    });
    this.armAckTimer(row.cid, row.clientMsgId);
  }

  private armAckTimer(cid: string, clientMsgId: string): void {
    this.clearAckTimer(clientMsgId);
    const timer = setTimeout(() => {
      this.ackTimers.delete(clientMsgId);
      void this.failIfSending(cid, clientMsgId, 'ACK_TIMEOUT');
    }, this.ackTimeoutMs);
    this.ackTimers.set(clientMsgId, timer);
  }

  private clearAckTimer(clientMsgId: string): void {
    const timer = this.ackTimers.get(clientMsgId);
    if (timer != null) {
      clearTimeout(timer);
      this.ackTimers.delete(clientMsgId);
    }
  }

  private async onAck(clientMsgId?: string): Promise<void> {
    if (!clientMsgId) return;
    this.clearAckTimer(clientMsgId);
    await this.outbox.setStatusWhere(clientMsgId, 'sending', 'acked', null);
    const row = await this.outbox.get(clientMsgId);
    if (row != null) {
      this.emitter.emit('message', { cid: row.cid });
    }
  }

  private async onEnvelope(env: Envelope): Promise<void> {
    if (env.op === OP.PUSH) {
      await this.engine.applyPush(env);
      return;
    }
    if (env.op === OP.ERROR) {
      await this.onError(env);
    }
    // 其余 op（READ 等）留给后续里程碑，这里忽略不动。
  }

  private async onError(env: Envelope): Promise<void> {
    const clientMsgId = env.clientMsgId;
    if (!clientMsgId) return;
    const reason = typeof env.body?.reason === 'string' ? env.body.reason : 'UNKNOWN';
    this.clearAckTimer(clientMsgId);
    const row = await this.outbox.get(clientMsgId);
    if (row == null) return;
    await this.fail(row.cid, clientMsgId, reason);
  }

  private async fail(cid: string, clientMsgId: string, reason: string): Promise<void> {
    await this.outbox.setStatus(clientMsgId, 'failed', reason);
    this.emitter.emit('message', { cid });
    this.emitter.emit('sendError', { cid, clientMsgId, reason });
  }

  /** 只有仍处于 sending 才判失败：ACK 已到（acked）或 PUSH 已到（行没了）都不该被改写。 */
  private async failIfSending(cid: string, clientMsgId: string, reason: string): Promise<void> {
    await this.outbox.setStatusWhere(clientMsgId, 'sending', 'failed', reason);
    const row = await this.outbox.get(clientMsgId);
    if (row?.status === 'failed' && row.error === reason) {
      this.emitter.emit('message', { cid });
      this.emitter.emit('sendError', { cid, clientMsgId, reason });
    }
  }
}
```

在 `src/index.ts` 末尾加：

```ts
export * from './chat/chatService';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd im-client/packages/im-sdk-core && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 5: 类型检查**

Run: `cd im-client && npx tsc -p packages/im-sdk-core --noEmit`
Expected: exit 0

- [ ] **Step 6: 提交**

```bash
cd /Users/xxmm/work/RBAC-Server
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): ChatService 发送编排（乐观写库/ACK 超时/ERROR 失败/重发）+ 下行帧路由（M2 Task4）"
```

---

## Task 5: op-sqlite 适配器 + createSdk 装配

**Files:**
- Create: `im-client/packages/im-sdk-rn/src/adapters/opSqliteDatabase.ts`
- Modify: `im-client/packages/im-sdk-rn/src/createSdk.ts`
- Modify: `im-client/packages/im-sdk-rn/src/index.ts`
- Modify: `im-client/packages/im-sdk-rn/package.json`
- Modify: `im-client/packages/app-mobile/package.json`（安装依赖）

**Interfaces:**
- Consumes: core 的 `Database` 端口、`runMigrations`、`MessageStore`、`OutboxStore`、`SyncEngine`、`ChatService`、`Emitter`、`SdkEvents`。
- Produces: `createSdk(config)` 返回 `{ auth, connection, chat, http, ids, ready }`，其中 `ready: Promise<void>` 在 open + 迁移完成后 resolve。

- [ ] **Step 1: 安装原生依赖**

```bash
cd /Users/xxmm/work/RBAC-Server/im-client/packages/app-mobile
npm install @op-engineering/op-sqlite
cd ios && pod install && cd ..    # macOS 上跑 iOS 时需要；只跑 Android 可跳过
```

在 `im-client/packages/im-sdk-rn/package.json` 的 `peerDependencies` 里加一行：

```json
    "@op-engineering/op-sqlite": ">=11"
```

> monorepo 提示：依赖会被 hoist 到 `im-client/node_modules`。M1 已把 Android 的 `settings.gradle` / `app/build.gradle` 改成用 `require.resolve` 定位包，autolinking 对 hoisted 包可正常工作；若 `./gradlew projects` 报找不到 op-sqlite，按同样的 `require.resolve` 方式排查，不要硬编码 `../node_modules`。

- [ ] **Step 2: 实现 op-sqlite 适配器**

新建 `im-client/packages/im-sdk-rn/src/adapters/opSqliteDatabase.ts`：

```ts
import { open, type DB } from '@op-engineering/op-sqlite';
import type { Database, Row, SqlValue } from '@im/sdk-core';

/** core 的 Database 端口在 RN 上的实现；SQL 与 sql.js/better-sqlite3 共享同一套脚本。 */
export class OpSqliteDatabase implements Database {
  private constructor(private readonly db: DB) {}

  static open(name = 'im.db'): OpSqliteDatabase {
    return new OpSqliteDatabase(open({ name }));
  }

  async exec(sql: string, params: SqlValue[] = []): Promise<void> {
    await this.db.execute(sql, params);
  }

  async query<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const res = await this.db.execute(sql, params);
    return (res.rows ?? []) as unknown as T[];
  }

  /** 与 sql.js 适配器同构：显式 BEGIN/COMMIT，异常回滚后原样抛出。 */
  async tx(fn: (tx: Database) => Promise<void>): Promise<void> {
    await this.exec('BEGIN');
    try {
      await fn(this);
      await this.exec('COMMIT');
    } catch (e) {
      await this.exec('ROLLBACK');
      throw e;
    }
  }
}
```

> 若 `tsc` 报 `res.rows` 类型不符（op-sqlite 不同大版本 rows 形态有差异：数组 vs `{_array}`），按当前安装版本的 `.d.ts` 调整这一行取值方式，不要用 `any` 掩盖。

- [ ] **Step 3: 装配 createSdk**

把 `im-client/packages/im-sdk-rn/src/createSdk.ts` 整个替换为：

```ts
import {
  AuthService,
  ChatService,
  ConnectionManager,
  Emitter,
  MessageStore,
  OutboxStore,
  SyncEngine,
  TOKEN_KEYS,
  runMigrations,
  type SdkEvents,
} from '@im/sdk-core';
import { AxiosHttp } from './adapters/axiosHttp';
import { WebSocketTransport } from './adapters/webSocketTransport';
import { KeychainSecureStore } from './adapters/keychainSecureStore';
import { AppStateLifecycle } from './adapters/appStateLifecycle';
import { OpSqliteDatabase } from './adapters/opSqliteDatabase';
import { rnIds } from './adapters/rnIds';

export interface SdkConfig {
  apiBaseUrl: string; // 例：http://10.0.2.2:8080/api
  wsBaseUrl: string;  // 例：ws://10.0.2.2:9001/im
  deviceId?: string;
  dbName?: string;
}

export function createSdk(config: SdkConfig) {
  const store = new KeychainSecureStore();
  const http = new AxiosHttp(config.apiBaseUrl, () => store.get(TOKEN_KEYS.access));
  const auth = new AuthService(http, store);
  const transport = new WebSocketTransport();
  const lifecycle = new AppStateLifecycle();
  const connection = new ConnectionManager(
    transport,
    lifecycle,
    () => auth.getAccessToken(),
    { wsBaseUrl: config.wsBaseUrl, deviceId: config.deviceId ?? rnIds.uuid() },
  );

  const db = OpSqliteDatabase.open(config.dbName ?? 'im.db');
  const emitter = new Emitter<SdkEvents>();
  const engine = new SyncEngine(db, emitter);
  const chat = new ChatService(
    connection,
    engine,
    new MessageStore(db),
    new OutboxStore(db),
    rnIds,
    emitter,
  );

  // 建表是异步的；调用方必须先 await ready 再用 chat。
  const ready = runMigrations(db);

  return { auth, connection, chat, http, ids: rnIds, ready };
}
```

在 `im-client/packages/im-sdk-rn/src/index.ts` 里补导出：

```ts
export * from './adapters/opSqliteDatabase';
```

- [ ] **Step 4: 类型检查**

Run: `cd im-client/packages/app-mobile && npx tsc --noEmit`
Expected: exit 0（这一步连带检查了 sdk-rn 的适配器）

- [ ] **Step 5: 验证 Android 原生工程能识别新依赖**

Run: `cd im-client/packages/app-mobile/android && ./gradlew projects`
Expected: BUILD SUCCESSFUL，且输出里出现 op-sqlite 相关子工程

- [ ] **Step 6: 提交**

```bash
cd /Users/xxmm/work/RBAC-Server
git add im-client/packages/im-sdk-rn im-client/packages/app-mobile/package.json im-client/package-lock.json
git add -u im-client/packages/app-mobile/ios 2>/dev/null || true
git commit -m "feat(im-client): op-sqlite Database 适配器 + createSdk 装配 chat/ready（M2 Task5）"
```

---

## Task 6: 导航骨架 + 选人页

**Files:**
- Modify: `im-client/packages/app-mobile/package.json`（安装导航依赖）
- Create: `im-client/packages/app-mobile/src/navigation/types.ts`
- Create: `im-client/packages/app-mobile/src/screens/ContactsScreen.tsx`
- Modify: `im-client/packages/app-mobile/App.tsx`
- Modify: `im-client/packages/app-mobile/src/store.ts`
- Modify: `im-client/packages/app-mobile/src/screens/LoginScreen.tsx`（无需改动逻辑，仅确认仍可用）

**Interfaces:**
- Consumes: Task 1 的 `buildSingleCid`、`AuthService.fetchMe`；Task 5 的 `sdk.http`、`sdk.ready`。
- Produces:
  - `type RootStackParamList = { Login: undefined; Contacts: undefined; Chat: { cid: string; peerId: number; peerName: string } }`
  - store 新增 `myId: number | null`、`booted: boolean`

- [ ] **Step 1: 安装导航依赖**

```bash
cd /Users/xxmm/work/RBAC-Server/im-client/packages/app-mobile
npm install @react-navigation/native @react-navigation/native-stack react-native-screens
cd ios && pod install && cd ..    # 只跑 Android 可跳过
```

Android 还需确认 `android/app/src/main/java/.../MainActivity.kt` 里有：

```kotlin
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)   // react-native-screens 要求：避免 Fragment 状态被系统恢复
  }
```

若文件里没有这个 override，就补上（需 `import android.os.Bundle`）。

- [ ] **Step 2: 定义路由类型**

新建 `src/navigation/types.ts`：

```ts
export type RootStackParamList = {
  Login: undefined;
  Contacts: undefined;
  Chat: { cid: string; peerId: number; peerName: string };
};
```

- [ ] **Step 3: store 加 myId 与 booted**

把 `src/store.ts` 整个替换为：

```ts
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
```

- [ ] **Step 4: 写选人页**

新建 `src/screens/ContactsScreen.tsx`：

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  Pressable,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { buildSingleCid } from '@im/sdk-core';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import type { RootStackParamList } from '../navigation/types';

interface UserRow {
  id: number;
  username: string;
  nickname: string;
}

interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

interface PageResult<T> {
  records: T[];
  total: number;
}

type Props = NativeStackScreenProps<RootStackParamList, 'Contacts'>;

export function ContactsScreen({ navigation }: Props) {
  const myId = useAppStore((s) => s.myId);
  const logout = useAppStore((s) => s.logout);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');

  const openChat = useCallback(
    (peerId: number, peerName: string) => {
      if (myId == null || peerId === myId || !Number.isFinite(peerId)) return;
      navigation.navigate('Chat', {
        cid: buildSingleCid(myId, peerId),
        peerId,
        peerName,
      });
    },
    [myId, navigation],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await sdk.http.get<ApiResult<PageResult<UserRow>>>('/system/users', {
          page: 1,
          pageSize: 50,
        });
        if (!alive) return;
        const list = (res.data?.records ?? []).filter((u) => u.id !== myId);
        setUsers(list);
        if (list.length === 0) {
          setHint('没有可选联系人（可能受数据权限过滤），可在下方直接输入对端 userId。');
        }
      } catch {
        if (alive) {
          setHint('拉取用户列表失败（缺少 system:user:list 权限？），请在下方直接输入对端 userId。');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [myId]);

  return (
    <View style={styles.wrap}>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => openChat(item.id, item.nickname || item.username)}>
            <Text style={styles.name}>{item.nickname || item.username}</Text>
            <Text style={styles.sub}>#{item.id}</Text>
          </Pressable>
        )}
      />
      <View style={styles.manual}>
        <TextInput
          style={styles.input}
          placeholder="直接输入对端 userId"
          keyboardType="number-pad"
          value={manualId}
          onChangeText={setManualId}
        />
        <Button
          title="进入会话"
          onPress={() => openChat(Number(manualId), `用户 ${manualId}`)}
        />
      </View>
      <Button title="登出" onPress={() => logout()} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  hint: { color: '#b45309', fontSize: 13 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  name: { fontSize: 16 },
  sub: { fontSize: 12, color: '#6b7280' },
  manual: { gap: 8 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12 },
});
```

- [ ] **Step 5: 换 App.tsx 为导航容器**

把 `App.tsx` 整个替换为（`ChatScreen` 在 Task 7 建，本步先用占位以保证可运行——**Task 7 会替换掉这个占位**）：

```tsx
/**
 * IM app-mobile：登录 → 选人 → 会话 三屏。
 *
 * @format
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppStore } from './src/store';
import { LoginScreen } from './src/screens/LoginScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { ConnectionStatusBar } from './src/components/ConnectionStatusBar';
import type { RootStackParamList } from './src/navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function ChatPlaceholder() {
  return (
    <View style={styles.center}>
      <Text>会话页在 Task 7 实现</Text>
    </View>
  );
}

function App() {
  const booted = useAppStore((x) => x.booted);
  const boot = useAppStore((x) => x.boot);
  const loggedIn = useAppStore((x) => x.loggedIn);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!booted) {
    return (
      <SafeAreaProvider>
        <View style={styles.center}>
          <Text>初始化本地数据库…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ConnectionStatusBar />
      <NavigationContainer>
        <Stack.Navigator>
          {!loggedIn ? (
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'IM 登录' }} />
          ) : (
            <>
              <Stack.Screen
                name="Contacts"
                component={ContactsScreen}
                options={{ title: '选择联系人' }}
              />
              <Stack.Screen
                name="Chat"
                component={ChatPlaceholder}
                options={({ route }) => ({ title: route.params.peerName })}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default App;
```

> `LoginScreen` 现在作为 Stack.Screen 使用，它不接收 props 也能正常渲染（组件签名无参数），无需改动。

- [ ] **Step 6: 类型检查**

Run: `cd im-client/packages/app-mobile && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 7: 在模拟器上验证三屏可跳转**

Run: `cd im-client/packages/app-mobile && npx react-native run-android`
Expected: 登录 `admin`/`admin123` 后进入"选择联系人"，能看到用户列表（或降级提示），点人后进入占位会话页且标题为对方昵称。

- [ ] **Step 8: 提交**

```bash
cd /Users/xxmm/work/RBAC-Server
git add im-client/packages/app-mobile im-client/package-lock.json
git commit -m "feat(im-client): app-mobile 接 React Navigation + 选人页（M2 Task6）"
```

---

## Task 7: 会话页（inverted FlatList + 输入栏 + 重发）

**Files:**
- Create: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`
- Modify: `im-client/packages/app-mobile/App.tsx`（用真实 ChatScreen 替换占位）

**Interfaces:**
- Consumes: `sdk.chat.getChatMessages/sendText/resend/on`、`ChatMessage`（Task 2）、`RootStackParamList`（Task 6）、store 的 `myId`。
- Produces: 无（终端 UI）。

- [ ] **Step 1: 写会话页**

新建 `src/screens/ChatScreen.tsx`：

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatMessage } from '@im/sdk-core';
import { sdk } from '../sdk';
import { useAppStore } from '../store';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

function textOf(m: ChatMessage): string {
  const t = m.body?.text;
  return typeof t === 'string' ? t : '';
}

export function ChatScreen({ route }: Props) {
  const { cid } = route.params;
  const myId = useAppStore((s) => s.myId);
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [banner, setBanner] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setItems(await sdk.chat.getChatMessages(cid));
  }, [cid]);

  useEffect(() => {
    void reload();
    const offMsg = sdk.chat.on('message', (p) => {
      if (p.cid === cid) void reload();
    });
    const offErr = sdk.chat.on('sendError', (p) => {
      if (p.cid !== cid) return;
      setBanner(`发送失败：${p.reason}`);
      setTimeout(() => setBanner(null), 3000);
    });
    return () => {
      offMsg();
      offErr();
    };
  }, [cid, reload]);

  // inverted 列表要倒序数据：最新的在数组头部。
  const data = useMemo(() => [...items].reverse(), [items]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text === '') return;
    setDraft('');
    await sdk.chat.sendText(cid, text);
  }, [cid, draft]);

  return (
    <View style={styles.wrap}>
      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => (m.seq != null ? `s:${m.seq}` : `c:${m.clientMsgId}`)}
        renderItem={({ item }) => {
          const mine = item.seq == null || item.senderId === myId;
          return (
            <View style={[styles.rowWrap, mine ? styles.rowMine : styles.rowPeer]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
                <Text style={mine ? styles.textMine : styles.textPeer}>{textOf(item)}</Text>
              </View>
              {item.status === 'sending' || item.status === 'acked' ? (
                <ActivityIndicator size="small" />
              ) : null}
              {item.status === 'failed' && item.clientMsgId ? (
                <Pressable onPress={() => sdk.chat.resend(item.clientMsgId!)}>
                  <Text style={styles.retry}>!</Text>
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="说点什么"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void send()}
        />
        <Button title="发送" onPress={() => void send()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  banner: { backgroundColor: '#fee2e2', color: '#b91c1c', padding: 8, textAlign: 'center' },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 4 },
  rowMine: { justifyContent: 'flex-end' },
  rowPeer: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '75%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: '#2563eb' },
  bubblePeer: { backgroundColor: '#e5e7eb' },
  textMine: { color: '#fff', fontSize: 15 },
  textPeer: { color: '#111827', fontSize: 15 },
  retry: { color: '#dc2626', fontSize: 18, fontWeight: '700', paddingHorizontal: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  input: { flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10 },
});
```

- [ ] **Step 2: 用真实会话页替换占位**

在 `App.tsx` 中：
1. 删掉 `ChatPlaceholder` 函数及其 `View`/`Text` 相关的未用 import（若 `styles.center` 仍被"初始化中"分支使用则保留）。
2. 加 `import { ChatScreen } from './src/screens/ChatScreen';`
3. 把 `component={ChatPlaceholder}` 改为 `component={ChatScreen}`。

- [ ] **Step 3: 类型检查**

Run: `cd im-client/packages/app-mobile && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: 单端冒烟**

Run: `cd im-client/packages/app-mobile && npx react-native run-android`
Expected: 登录 → 选人 → 会话页；输入文本点发送后立刻出现右侧蓝色气泡并转圈，网关在线时转圈消失（对账完成）。

- [ ] **Step 5: 提交**

```bash
cd /Users/xxmm/work/RBAC-Server
git add im-client/packages/app-mobile
git commit -m "feat(im-client): 会话页 inverted 消息流 + 输入栏 + 失败重发（M2 Task7）"
```

---

## Task 8: 端到端联调与收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-07-27-im-client-rn-portable-design.md`（里程碑标注）
- Modify: `.superpowers/sdd/progress.md`（进度台账）

**Interfaces:**
- Consumes: Task 1–7 的全部产出。
- Produces: 联调结论与台账记录。

- [ ] **Step 1: 起后端与网关**

```bash
cd /Users/xxmm/work/RBAC-Server/deploy && docker compose --profile im --profile full up -d
mvn -f /Users/xxmm/work/RBAC-Server/backend/pom.xml spring-boot:run
mvn -f /Users/xxmm/work/RBAC-Server/im-gateway/pom.xml spring-boot:run
```

- [ ] **Step 2: 准备第二个测试账号**

用浏览器打开 RBAC 前端的"系统管理 → 用户管理"，新建一个可登录账号（例如 `imtest` / 自设密码），分配一个普通角色。**不要写 SQL、不要直调接口**（用户明确偏好走界面操作）。记下它的 userId。

- [ ] **Step 3: 双端在线互发**

在两个 Android 模拟器实例（或一个模拟器 + 一个改了 `deviceId` 的实例）分别登录 `admin` 与新账号，互相选中对方进入会话页，各发 2 条文本。

Expected：
- 发送方本地立刻出现气泡（转圈）→ 转圈消失
- 接收方无需刷新即出现对方消息（左侧灰色气泡）

- [ ] **Step 4: 失败与重发幂等**

停掉 im-gateway 进程，在 A 端发一条消息 → 气泡出现红色 `!`（`OFFLINE` 或 `ACK_TIMEOUT`）。重新起 im-gateway、等状态条变为已连接后点击 `!` 重发。

Expected：重发成功，且 **B 端只收到一条**（clientMsgId 幂等生效）。

- [ ] **Step 5: 持久化验证**

杀掉 A 端 App 进程后重新打开，进入同一会话。

Expected：此前已发送成功的消息仍在（SQLite 持久化）；失败未重发的消息也仍在且可继续重发。

- [ ] **Step 6: 记录结论**

在 `docs/superpowers/specs/2026-07-27-im-client-rn-portable-design.md` 的里程碑列表中，把 `M2 · 单聊文本闭环` 一项标注为已完成（形如 `**M2 · 单聊文本闭环**（已完成 2026-07-27）`）。

在 `.superpowers/sdd/progress.md` 末尾追加一段进度台账：

```markdown
---
# 进度台账 · IM 客户端 M2（单聊文本闭环）

Plan: docs/superpowers/plans/2026-07-27-im-client-m2-single-chat.md
Branch: feat/im
Base(起点): 82f8d6b

- Task 1~8: <逐条填实际 commit 哈希与评审结论>

## 端到端联调结论
- 双端在线互发：<结果>
- 失败重发幂等（B 端只收一条）：<结果>
- 杀进程持久化：<结果>
```

（把 `<...>` 换成实际结果，不要留占位符。）

- [ ] **Step 7: 全量回归**

Run:
```bash
cd /Users/xxmm/work/RBAC-Server/im-client && npm test --workspace @im/sdk-core
cd /Users/xxmm/work/RBAC-Server/im-client && npx tsc -p packages/im-sdk-core --noEmit
cd /Users/xxmm/work/RBAC-Server/im-client/packages/app-mobile && npx tsc --noEmit
```
Expected: 测试全绿、两处 tsc exit 0

- [ ] **Step 8: 提交**

```bash
cd /Users/xxmm/work/RBAC-Server
git add docs/superpowers/specs/2026-07-27-im-client-rn-portable-design.md .superpowers/sdd/progress.md
git commit -m "docs(im-client): M2 单聊文本闭环联调完成，更新里程碑与进度台账"
```

---

## 完成标准

- core 单测全绿，覆盖：outbox 迁移/读写/条件更新、mergeChatMessages 拼接、applyPush 的落库·对账·幂等·乱序不回退·脏帧丢弃、ChatService 的发送·OFFLINE·ACK·超时·超时不覆盖 acked·ERROR·重发·PUSH 路由。
- `tsc -p packages/im-sdk-core --noEmit` 与 app-mobile `tsc --noEmit` 均 exit 0。
- 端到端：双端在线互发通过、失败重发不产生重复消息、杀进程后本地消息仍在。
- `im-sdk-core` 目录内 grep 不到 `react` / `react-native` / `op-sqlite` / Node 内置模块的 import。
