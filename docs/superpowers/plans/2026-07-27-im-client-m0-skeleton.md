# IM 客户端 M0（Monorepo 骨架与分层）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起可移植 IM SDK 的 monorepo 骨架，交付一个零平台依赖的 `im-sdk-core`（协议类型 + ports 接口 + SQLite 迁移 + 仓储层 + 事件总线），并用 sql.js 在 Node 里跑通"建表 + 假消息读写"单测。

**Architecture:** 六边形（Ports & Adapters）。`im-sdk-core` 是纯 TypeScript，只依赖自己定义的 ports 接口，绝不 import `react`/`react-native`/`op-sqlite`/node 内置模块。平台能力（数据库等）由适配器在运行时注入；M0 只提供一个 **测试专用** 的 sql.js `Database` 实现来驱动 core 的单测。`im-sdk-rn` 本期仅建包壳，真实适配器从 M1 起补齐；Electron 适配器本期只在 ports 里留接口、不建包。

**Tech Stack:** TypeScript 5、npm workspaces、vitest（core 单测）、sql.js（WASM SQLite，测试用）。目标运行时 Node ≥ 22（仓库现装 Node 24 / npm 11）。

## Global Constraints

- 新 monorepo 根目录：`im-client/`（顶层，和 `frontend/` 平级隔离）。
- 包管理器：**npm workspaces**（仓库 `frontend/` 已用 npm，统一）。
- `im-sdk-core/src/**` 禁止出现 `import ... from 'react'`、`'react-native'`、`'op-sqlite'` 及 node 内置模块（`fs`/`path`/`crypto`/...）。所有平台能力走 `ports`。
- `Database` 端口统一 **Promise 化**（同步驱动包一层 `Promise.resolve`），事务用回调式 `tx(fn)`。
- 消息主键 `(cid, seq)`；消息 `body` 在库内以 JSON 字符串列 `body_json` 存储。
- 每个迁移条目是**单条 SQL 语句**（跨 op-sqlite / sql.js / better-sqlite3 一致，避免多语句 exec 分歧）。
- 提交信息用中文、`feat(im-client):` / `test(im-client):` / `chore(im-client):` 前缀；提交在当前分支 `feat/im` 上进行。

---

### Task 1: Monorepo 骨架 + core 包 + rn 包壳，vitest 跑通

**Files:**
- Create: `im-client/package.json`
- Create: `im-client/tsconfig.base.json`
- Create: `im-client/.gitignore`
- Create: `im-client/packages/im-sdk-core/package.json`
- Create: `im-client/packages/im-sdk-core/tsconfig.json`
- Create: `im-client/packages/im-sdk-core/vitest.config.ts`
- Create: `im-client/packages/im-sdk-core/src/index.ts`
- Create: `im-client/packages/im-sdk-rn/package.json`
- Create: `im-client/packages/im-sdk-rn/src/index.ts`
- Test: `im-client/packages/im-sdk-core/test/smoke.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）。
- Produces: 可运行的 workspace；在 `im-client/` 下 `npm test` 会执行 `im-sdk-core` 的 vitest。core 包名 `@im/sdk-core`，rn 包名 `@im/sdk-rn`。

- [ ] **Step 1: 创建 workspace 根 `im-client/package.json`**

```json
{
  "name": "im-client",
  "private": true,
  "version": "0.0.0",
  "workspaces": [
    "packages/*"
  ],
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "npm run test --workspace @im/sdk-core"
  }
}
```

- [ ] **Step 2: 创建 `im-client/tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": []
  }
}
```

- [ ] **Step 3: 创建 `im-client/.gitignore`**

```gitignore
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 4: 创建 core 包 `im-client/packages/im-sdk-core/package.json`**

```json
{
  "name": "@im/sdk-core",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "sql.js": "^1.12.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 5: 创建 `im-client/packages/im-sdk-core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: 创建 `im-client/packages/im-sdk-core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 7: 创建 core 入口 `im-client/packages/im-sdk-core/src/index.ts`**

```ts
export const SDK_VERSION = '0.0.0';
```

- [ ] **Step 8: 创建 rn 包壳 `im-client/packages/im-sdk-rn/package.json`**

```json
{
  "name": "@im/sdk-rn",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "peerDependencies": {
    "@im/sdk-core": "*"
  }
}
```

- [ ] **Step 9: 创建 rn 包占位入口 `im-client/packages/im-sdk-rn/src/index.ts`**

```ts
// M0：仅建包壳。op-sqlite / RN WebSocket / keychain 等适配器从 M1 起补齐。
export {};
```

- [ ] **Step 10: 写冒烟测试 `im-client/packages/im-sdk-core/test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { SDK_VERSION } from '../src/index';

describe('smoke', () => {
  it('exposes SDK_VERSION', () => {
    expect(SDK_VERSION).toBe('0.0.0');
  });
});
```

- [ ] **Step 11: 安装依赖并跑测试（验证先失败再通过的前提：先安装）**

Run:
```bash
cd im-client && npm install
```
Expected: 安装成功，生成 `im-client/package-lock.json` 与 `node_modules/`（含 sql.js、vitest）。

- [ ] **Step 12: 运行测试**

Run:
```bash
cd im-client && npm test
```
Expected: PASS，1 个测试通过（`smoke > exposes SDK_VERSION`）。

- [ ] **Step 13: 提交**

```bash
git add im-client
git commit -m "chore(im-client): monorepo 骨架 + im-sdk-core/im-sdk-rn 包壳，vitest 跑通"
```

---

### Task 2: 协议类型与常量（Envelope / op / body / isMedia）

**Files:**
- Create: `im-client/packages/im-sdk-core/src/protocol/types.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`
- Test: `im-client/packages/im-sdk-core/test/protocol.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - 常量 `OP = { SEND, RECALL, READ, ACK, PUSH, ERROR } as const`。
  - 类型 `Envelope`（字段对齐接口文档 §4.3）、`MessageType`（`'TEXT'|'IMAGE'|'AUDIO'|'FILE'|'LINK'|'RECALL'|'SYSTEM'`）。
  - 函数 `isMedia(type: string | null | undefined): boolean` —— 仅 `IMAGE/AUDIO/FILE` 为 true，`null/undefined` 返回 false（不抛异常）。

- [ ] **Step 1: 写失败测试 `test/protocol.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { OP, isMedia } from '../src/index';

describe('protocol', () => {
  it('OP has stable string values', () => {
    expect(OP.SEND).toBe('SEND');
    expect(OP.PUSH).toBe('PUSH');
    expect(OP.READ).toBe('READ');
  });

  it('isMedia is true only for IMAGE/AUDIO/FILE', () => {
    expect(isMedia('IMAGE')).toBe(true);
    expect(isMedia('AUDIO')).toBe(true);
    expect(isMedia('FILE')).toBe(true);
    expect(isMedia('TEXT')).toBe(false);
  });

  it('isMedia is null-safe', () => {
    expect(isMedia(null)).toBe(false);
    expect(isMedia(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd im-client && npx vitest run test/protocol.test.ts --dir packages/im-sdk-core`
Expected: FAIL（`OP`/`isMedia` 未从 index 导出）。

- [ ] **Step 3: 写 `src/protocol/types.ts`**

```ts
export const OP = {
  SEND: 'SEND',
  RECALL: 'RECALL',
  READ: 'READ',
  ACK: 'ACK',
  PUSH: 'PUSH',
  ERROR: 'ERROR',
} as const;

export type Op = (typeof OP)[keyof typeof OP];

export type MessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'FILE'
  | 'LINK'
  | 'RECALL'
  | 'SYSTEM';

/** 网关/客户端统一消息信封（对齐接口文档 §4.3）。 */
export interface Envelope {
  op: Op;
  cid?: string;
  senderId?: number;
  deviceId?: string;
  clientMsgId?: string;
  type?: MessageType;
  body?: Record<string, unknown>;
  seq?: number;
  msgId?: string;
  ts?: number;
}

const MEDIA_TYPES = new Set<string>(['IMAGE', 'AUDIO', 'FILE']);

/** null-safe：缺 type 的报文不能炸线程。 */
export function isMedia(type: string | null | undefined): boolean {
  return type != null && MEDIA_TYPES.has(type);
}
```

- [ ] **Step 4: 从 `src/index.ts` 导出协议**

```ts
export const SDK_VERSION = '0.0.0';
export * from './protocol/types';
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd im-client && npm test`
Expected: PASS（smoke + protocol 共 4 个测试通过）。

- [ ] **Step 6: 提交**

```bash
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): core 协议类型与常量（Envelope/OP/isMedia）"
```

---

### Task 3: ports 接口 + sql.js 测试 Database + 版本化迁移

**Files:**
- Create: `im-client/packages/im-sdk-core/src/ports/index.ts`
- Create: `im-client/packages/im-sdk-core/src/store/migrations.ts`
- Create: `im-client/packages/im-sdk-core/test/support/sqljsDatabase.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`
- Test: `im-client/packages/im-sdk-core/test/migrations.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - 端口类型：`SqlValue = string | number | null`、`Row = Record<string, SqlValue>`、`Database { exec(sql, params?): Promise<void>; query<T>(sql, params?): Promise<T[]>; tx(fn: (tx: Database) => Promise<void>): Promise<void> }`；以及 `Transport`、`Http`、`SecureStore`、`MediaPicker`、`AppLifecycle`、`Ids` 接口（M1+ 使用，M0 先定义）。
  - `MIGRATIONS: string[]`（每项单条 SQL）与 `runMigrations(db: Database): Promise<void>`（幂等，可重复调用）。
  - 测试工具 `createSqljsDatabase(): Promise<Database>`（仅 test 目录，非 core 源码）。

- [ ] **Step 1: 写失败测试 `test/migrations.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { runMigrations } from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

describe('migrations', () => {
  it('creates conversations/messages/sync_meta tables', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);

    const tables = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('conversations');
    expect(names).toContain('messages');
    expect(names).toContain('sync_meta');
  });

  it('is idempotent (second run is a no-op)', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    await runMigrations(db); // 不应抛错
    const rows = await db.query<{ version: number }>(
      `SELECT version FROM _migrations ORDER BY version`,
    );
    expect(rows.length).toBe(3);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd im-client && npx vitest run test/migrations.test.ts --dir packages/im-sdk-core`
Expected: FAIL（`runMigrations` / `createSqljsDatabase` 不存在）。

- [ ] **Step 3: 写 ports 接口 `src/ports/index.ts`**

```ts
// —— 数据库端口（全 Promise 化；同步驱动包一层 Promise.resolve）——
export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface Database {
  exec(sql: string, params?: SqlValue[]): Promise<void>;
  query<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  tx(fn: (tx: Database) => Promise<void>): Promise<void>;
}

// —— 长连接端口（M1 实现）——
export type TransportState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed';

export interface Transport {
  connect(url: string): void;
  send(text: string): void;
  onMessage(handler: (text: string) => void): void;
  onState(handler: (state: TransportState) => void): void;
  close(): void;
}

// —— HTTP 端口（M1 实现，axios 适配）——
export interface Http {
  get<T>(path: string, params?: Record<string, unknown>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put(url: string, body: unknown, headers?: Record<string, string>): Promise<void>;
}

// —— 安全存储端口（M1 实现，keychain）——
export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

// —— 媒体选择端口（M5 实现）——
export interface PickedMedia {
  uri: string;
  filename: string;
  mime: string;
  size: number;
}

export interface MediaPicker {
  pickImage(): Promise<PickedMedia | null>;
  pickFile(): Promise<PickedMedia | null>;
}

// —— 生命周期端口（M1 实现，AppState）——
export interface AppLifecycle {
  onForeground(handler: () => void): void;
  onBackground(handler: () => void): void;
}

// —— id / 时间端口（Hermes 不保证 crypto.randomUUID）——
export interface Ids {
  uuid(): string;
  now(): number;
}
```

- [ ] **Step 4: 写迁移 `src/store/migrations.ts`**

```ts
import type { Database } from '../ports/index';

/** 每项单条 SQL；跨 sql.js / op-sqlite / better-sqlite3 一致。 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE conversations (
     cid TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     group_id INTEGER,
     last_msg_seq INTEGER NOT NULL DEFAULT 0,
     last_msg_preview TEXT,
     last_read_seq INTEGER NOT NULL DEFAULT 0,
     peer_read_seq INTEGER,
     mention_seq INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE messages (
     cid TEXT NOT NULL,
     seq INTEGER NOT NULL,
     msg_id TEXT,
     client_msg_id TEXT,
     sender_id INTEGER,
     type TEXT NOT NULL,
     body_json TEXT,
     recalled INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'sent',
     ts INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (cid, seq)
   )`,
  `CREATE TABLE sync_meta (
     cid TEXT PRIMARY KEY,
     synced_seq INTEGER NOT NULL DEFAULT 0
   )`,
];

/** 幂等：用 _migrations 表记录已应用版本，可重复调用。 */
export async function runMigrations(db: Database): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
  const applied = await db.query<{ version: number }>(
    `SELECT version FROM _migrations`,
  );
  const done = new Set(applied.map((r) => r.version));

  for (let version = 0; version < MIGRATIONS.length; version++) {
    if (done.has(version)) continue;
    const sql = MIGRATIONS[version];
    await db.tx(async (tx) => {
      await tx.exec(sql);
      await tx.exec(`INSERT INTO _migrations (version, applied_at) VALUES (?, ?)`, [
        version,
        Date.now(),
      ]);
    });
  }
}
```

- [ ] **Step 5: 写测试专用 sql.js Database `test/support/sqljsDatabase.ts`**

```ts
import initSqlJs, { type Database as SqlJsDb, type SqlValue as JsVal } from 'sql.js';
import type { Database, SqlValue } from '../../src/ports/index';

/** sql.js 是同步 WASM 库；这里包成 core 的 Promise 化 Database 端口（仅测试用）。 */
class SqljsDatabase implements Database {
  constructor(private readonly db: SqlJsDb) {}

  async exec(sql: string, params: SqlValue[] = []): Promise<void> {
    this.db.run(sql, params as JsVal[]);
  }

  async query<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as JsVal[]);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as T);
    }
    stmt.free();
    return rows;
  }

  async tx(fn: (tx: Database) => Promise<void>): Promise<void> {
    this.db.run('BEGIN');
    try {
      await fn(this);
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
  }
}

export async function createSqljsDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  return new SqljsDatabase(new SQL.Database());
}
```

- [ ] **Step 6: 从 `src/index.ts` 导出 ports 与 migrations**

```ts
export const SDK_VERSION = '0.0.0';
export * from './protocol/types';
export * from './ports/index';
export * from './store/migrations';
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd im-client && npm test`
Expected: PASS（smoke + protocol + migrations，共 6 个测试通过）。

- [ ] **Step 8: 提交**

```bash
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): core ports 接口 + SQLite 版本化迁移 + sql.js 测试 Database"
```

---

### Task 4: 仓储层 MessageStore（消息去重读写 + 会话 + 位点）

**Files:**
- Create: `im-client/packages/im-sdk-core/src/store/messageStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`
- Test: `im-client/packages/im-sdk-core/test/messageStore.test.ts`

**Interfaces:**
- Consumes: `Database`（Task 3）、`runMigrations`（Task 3）。
- Produces:
  - 类型 `StoredMessage { cid: string; seq: number; msgId: string | null; clientMsgId: string | null; senderId: number | null; type: string; body: Record<string, unknown> | null; recalled: boolean; status: string; ts: number }`。
  - 类 `MessageStore`：
    - `constructor(db: Database)`
    - `upsertMessage(m: StoredMessage): Promise<void>` —— 按 `(cid, seq)` 去重/覆盖（INSERT ON CONFLICT）。
    - `getMessages(cid: string): Promise<StoredMessage[]>` —— 按 seq 升序，`body_json` 反序列化。
    - `upsertConversation(c: { cid: string; type: string; groupId: number | null; lastMsgSeq: number; lastMsgPreview: string | null }): Promise<void>`
    - `getConversations(): Promise<Array<{ cid: string; type: string; lastMsgSeq: number }>>`
    - `getSyncedSeq(cid: string): Promise<number>` / `setSyncedSeq(cid: string, seq: number): Promise<void>`

- [ ] **Step 1: 写失败测试 `test/messageStore.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { MessageStore, runMigrations, type StoredMessage } from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

function msg(over: Partial<StoredMessage> = {}): StoredMessage {
  return {
    cid: 'c_1_2',
    seq: 1,
    msgId: 'm1',
    clientMsgId: null,
    senderId: 1,
    type: 'TEXT',
    body: { text: 'hi' },
    recalled: false,
    status: 'sent',
    ts: 1000,
    ...over,
  };
}

describe('MessageStore', () => {
  it('writes and reads a message with body round-trip', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    await store.upsertMessage(msg());
    const rows = await store.getMessages('c_1_2');

    expect(rows.length).toBe(1);
    expect(rows[0].seq).toBe(1);
    expect(rows[0].body).toEqual({ text: 'hi' });
    expect(rows[0].recalled).toBe(false);
  });

  it('dedupes by (cid, seq): re-upsert overwrites, no duplicate row', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    await store.upsertMessage(msg({ body: { text: 'v1' } }));
    await store.upsertMessage(msg({ body: { text: 'v2' } }));

    const rows = await store.getMessages('c_1_2');
    expect(rows.length).toBe(1);
    expect(rows[0].body).toEqual({ text: 'v2' });
  });

  it('returns messages ordered by seq ascending', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    await store.upsertMessage(msg({ seq: 3 }));
    await store.upsertMessage(msg({ seq: 1 }));
    await store.upsertMessage(msg({ seq: 2 }));

    const rows = await store.getMessages('c_1_2');
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it('tracks synced_seq per conversation (default 0)', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    expect(await store.getSyncedSeq('c_1_2')).toBe(0);
    await store.setSyncedSeq('c_1_2', 5);
    expect(await store.getSyncedSeq('c_1_2')).toBe(5);
  });

  it('upserts and lists conversations', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);

    await store.upsertConversation({
      cid: 'g_10',
      type: 'GROUP',
      groupId: 10,
      lastMsgSeq: 7,
      lastMsgPreview: 'hello',
    });
    const rows = await store.getConversations();
    expect(rows.length).toBe(1);
    expect(rows[0].cid).toBe('g_10');
    expect(rows[0].lastMsgSeq).toBe(7);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd im-client && npx vitest run test/messageStore.test.ts --dir packages/im-sdk-core`
Expected: FAIL（`MessageStore` / `StoredMessage` 未导出）。

- [ ] **Step 3: 写 `src/store/messageStore.ts`**

```ts
import type { Database, Row } from '../ports/index';

export interface StoredMessage {
  cid: string;
  seq: number;
  msgId: string | null;
  clientMsgId: string | null;
  senderId: number | null;
  type: string;
  body: Record<string, unknown> | null;
  recalled: boolean;
  status: string;
  ts: number;
}

export class MessageStore {
  constructor(private readonly db: Database) {}

  async upsertMessage(m: StoredMessage): Promise<void> {
    await this.db.exec(
      `INSERT INTO messages
         (cid, seq, msg_id, client_msg_id, sender_id, type, body_json, recalled, status, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid, seq) DO UPDATE SET
         msg_id=excluded.msg_id,
         client_msg_id=excluded.client_msg_id,
         sender_id=excluded.sender_id,
         type=excluded.type,
         body_json=excluded.body_json,
         recalled=excluded.recalled,
         status=excluded.status,
         ts=excluded.ts`,
      [
        m.cid,
        m.seq,
        m.msgId,
        m.clientMsgId,
        m.senderId,
        m.type,
        m.body === null ? null : JSON.stringify(m.body),
        m.recalled ? 1 : 0,
        m.status,
        m.ts,
      ],
    );
  }

  async getMessages(cid: string): Promise<StoredMessage[]> {
    const rows = await this.db.query<Row>(
      `SELECT cid, seq, msg_id, client_msg_id, sender_id, type, body_json, recalled, status, ts
         FROM messages WHERE cid = ? ORDER BY seq ASC`,
      [cid],
    );
    return rows.map((r) => ({
      cid: r.cid as string,
      seq: r.seq as number,
      msgId: (r.msg_id as string | null) ?? null,
      clientMsgId: (r.client_msg_id as string | null) ?? null,
      senderId: (r.sender_id as number | null) ?? null,
      type: r.type as string,
      body: r.body_json == null ? null : (JSON.parse(r.body_json as string) as Record<string, unknown>),
      recalled: (r.recalled as number) === 1,
      status: r.status as string,
      ts: r.ts as number,
    }));
  }

  async upsertConversation(c: {
    cid: string;
    type: string;
    groupId: number | null;
    lastMsgSeq: number;
    lastMsgPreview: string | null;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO conversations (cid, type, group_id, last_msg_seq, last_msg_preview, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid) DO UPDATE SET
         type=excluded.type,
         group_id=excluded.group_id,
         last_msg_seq=excluded.last_msg_seq,
         last_msg_preview=excluded.last_msg_preview,
         updated_at=excluded.updated_at`,
      [c.cid, c.type, c.groupId, c.lastMsgSeq, c.lastMsgPreview, Date.now()],
    );
  }

  async getConversations(): Promise<
    Array<{ cid: string; type: string; lastMsgSeq: number }>
  > {
    const rows = await this.db.query<Row>(
      `SELECT cid, type, last_msg_seq FROM conversations ORDER BY updated_at DESC`,
    );
    return rows.map((r) => ({
      cid: r.cid as string,
      type: r.type as string,
      lastMsgSeq: r.last_msg_seq as number,
    }));
  }

  async getSyncedSeq(cid: string): Promise<number> {
    const rows = await this.db.query<Row>(
      `SELECT synced_seq FROM sync_meta WHERE cid = ?`,
      [cid],
    );
    return rows.length ? (rows[0].synced_seq as number) : 0;
  }

  async setSyncedSeq(cid: string, seq: number): Promise<void> {
    await this.db.exec(
      `INSERT INTO sync_meta (cid, synced_seq) VALUES (?, ?)
       ON CONFLICT(cid) DO UPDATE SET synced_seq=excluded.synced_seq`,
      [cid, seq],
    );
  }
}
```

- [ ] **Step 4: 从 `src/index.ts` 导出仓储层**

```ts
export const SDK_VERSION = '0.0.0';
export * from './protocol/types';
export * from './ports/index';
export * from './store/migrations';
export * from './store/messageStore';
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd im-client && npm test`
Expected: PASS（smoke + protocol + migrations + messageStore，共 11 个测试通过）。

- [ ] **Step 6: 提交**

```bash
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): core 仓储层 MessageStore（消息去重读写/会话/synced_seq）"
```

---

### Task 5: 事件总线 + 同步引擎壳（写入即发变更事件）

**Files:**
- Create: `im-client/packages/im-sdk-core/src/events/emitter.ts`
- Create: `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`
- Test: `im-client/packages/im-sdk-core/test/emitter.test.ts`
- Test: `im-client/packages/im-sdk-core/test/syncEngine.test.ts`

**Interfaces:**
- Consumes: `Database`、`MessageStore`、`StoredMessage`、`runMigrations`。
- Produces:
  - 类 `Emitter<E extends Record<string, unknown>>`：`on<K>(k, fn)`、`off<K>(k, fn)`、`emit<K>(k, payload)`；`on` 返回取消订阅函数。
  - 类型 `SdkEvents = { message: { cid: string }; conversation: { cid: string } }`。
  - 类 `SyncEngine`：`constructor(store: MessageStore, emitter: Emitter<SdkEvents>)`；`applyIncoming(m: StoredMessage): Promise<void>` —— 落库后 emit `message` 与 `conversation`（payload `{ cid }`）。这是 M1+ 处理 PUSH/pull 的落点壳。

- [ ] **Step 1: 写事件总线失败测试 `test/emitter.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Emitter } from '../src/index';

type E = { ping: { n: number } };

describe('Emitter', () => {
  it('delivers emitted payloads to subscribers', () => {
    const em = new Emitter<E>();
    const seen: number[] = [];
    em.on('ping', (p) => seen.push(p.n));
    em.emit('ping', { n: 1 });
    em.emit('ping', { n: 2 });
    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribe via returned disposer stops delivery', () => {
    const em = new Emitter<E>();
    const seen: number[] = [];
    const off = em.on('ping', (p) => seen.push(p.n));
    em.emit('ping', { n: 1 });
    off();
    em.emit('ping', { n: 2 });
    expect(seen).toEqual([1]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd im-client && npx vitest run test/emitter.test.ts --dir packages/im-sdk-core`
Expected: FAIL（`Emitter` 未导出）。

- [ ] **Step 3: 写 `src/events/emitter.ts`**

```ts
type Handler<T> = (payload: T) => void;

export class Emitter<E extends Record<string, unknown>> {
  private readonly handlers: { [K in keyof E]?: Set<Handler<E[K]>> } = {};

  on<K extends keyof E>(key: K, fn: Handler<E[K]>): () => void {
    (this.handlers[key] ??= new Set()).add(fn);
    return () => this.off(key, fn);
  }

  off<K extends keyof E>(key: K, fn: Handler<E[K]>): void {
    this.handlers[key]?.delete(fn);
  }

  emit<K extends keyof E>(key: K, payload: E[K]): void {
    this.handlers[key]?.forEach((fn) => fn(payload));
  }
}
```

- [ ] **Step 4: 写同步引擎壳失败测试 `test/syncEngine.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  Emitter,
  MessageStore,
  SyncEngine,
  runMigrations,
  type SdkEvents,
  type StoredMessage,
} from '../src/index';
import { createSqljsDatabase } from './support/sqljsDatabase';

function msg(over: Partial<StoredMessage> = {}): StoredMessage {
  return {
    cid: 'c_1_2',
    seq: 1,
    msgId: 'm1',
    clientMsgId: null,
    senderId: 1,
    type: 'TEXT',
    body: { text: 'hi' },
    recalled: false,
    status: 'sent',
    ts: 1000,
    ...over,
  };
}

describe('SyncEngine', () => {
  it('persists incoming message and emits message + conversation events', async () => {
    const db = await createSqljsDatabase();
    await runMigrations(db);
    const store = new MessageStore(db);
    const emitter = new Emitter<SdkEvents>();

    const messageCids: string[] = [];
    const convCids: string[] = [];
    emitter.on('message', (p) => messageCids.push(p.cid));
    emitter.on('conversation', (p) => convCids.push(p.cid));

    const engine = new SyncEngine(store, emitter);
    await engine.applyIncoming(msg());

    const rows = await store.getMessages('c_1_2');
    expect(rows.length).toBe(1);
    expect(messageCids).toEqual(['c_1_2']);
    expect(convCids).toEqual(['c_1_2']);
  });
});
```

- [ ] **Step 5: 运行确认失败**

Run: `cd im-client && npx vitest run test/syncEngine.test.ts --dir packages/im-sdk-core`
Expected: FAIL（`SyncEngine` / `SdkEvents` 未导出）。

- [ ] **Step 6: 写 `src/engine/syncEngine.ts`**

```ts
import type { Emitter } from '../events/emitter';
import type { MessageStore, StoredMessage } from '../store/messageStore';

export interface SdkEvents extends Record<string, unknown> {
  message: { cid: string };
  conversation: { cid: string };
}

/**
 * 同步引擎壳：SQLite 单一事实源的落点。
 * M0 只做"落库 + 发变更事件"；M1+ 在此扩展 PUSH/pull 归一、clientMsgId 对账、撤回改写。
 */
export class SyncEngine {
  constructor(
    private readonly store: MessageStore,
    private readonly emitter: Emitter<SdkEvents>,
  ) {}

  async applyIncoming(m: StoredMessage): Promise<void> {
    await this.store.upsertMessage(m);
    this.emitter.emit('message', { cid: m.cid });
    this.emitter.emit('conversation', { cid: m.cid });
  }
}
```

- [ ] **Step 7: 从 `src/index.ts` 导出事件总线与引擎**

```ts
export const SDK_VERSION = '0.0.0';
export * from './protocol/types';
export * from './ports/index';
export * from './store/migrations';
export * from './store/messageStore';
export * from './events/emitter';
export * from './engine/syncEngine';
```

- [ ] **Step 8: 运行全部测试确认通过**

Run: `cd im-client && npm test`
Expected: PASS（smoke + protocol + migrations + messageStore + emitter + syncEngine，共 14 个测试通过）。

- [ ] **Step 9: 类型检查（守住"core 零平台依赖"与类型正确）**

Run: `cd im-client && npx tsc --noEmit -p packages/im-sdk-core/tsconfig.json`
Expected: 无错误输出（exit 0）。

- [ ] **Step 10: 提交**

```bash
git add im-client/packages/im-sdk-core
git commit -m "feat(im-client): core 事件总线 Emitter + 同步引擎壳 SyncEngine"
```

---

## 验收（M0 完成标志）

- `cd im-client && npm test` 全绿（14 个测试）。
- `cd im-client && npx tsc --noEmit -p packages/im-sdk-core/tsconfig.json` 无错误。
- `im-sdk-core/src/**` 无任何 `react`/`react-native`/`op-sqlite`/node 内置模块 import（sql.js 仅出现在 `test/support/`）。
- 目录结构：`im-client/`（workspace 根）+ `packages/im-sdk-core`（协议/ports/迁移/仓储/事件/引擎壳）+ `packages/im-sdk-rn`（包壳）。

## Self-Review

**1. Spec 覆盖**：M0 spec 要素 —— workspaces 三包（本计划建 core + rn 包壳；`app-mobile` RN init 依赖原生工具链且 M0 验收为纯 core，按计划头说明挪到 M1 UI 首现时，属对 spec 分组的合理细化，非漏项）✅；全部 ports 接口定义（Task 3，含 Electron 留空实现的接口）✅；SQLite schema + 迁移（Task 3）✅；事件总线（Task 5）✅；同步引擎壳（Task 5）✅；sql.js 跑通建表 + 假消息读写（Task 3/4）✅。
**2. 占位符扫描**：无 TBD/TODO/"add error handling"；每个 code step 均给出完整代码。✅
**3. 类型一致性**：`Database`/`SqlValue`/`Row` 在 ports 定义并被 sqljsDatabase、migrations、messageStore 一致使用；`StoredMessage` 在 messageStore 定义并被 syncEngine 与测试一致引用；`SdkEvents` 键 `message`/`conversation` 在 engine 定义并被测试一致订阅；`Emitter.on` 返回 disposer 与测试一致。✅
