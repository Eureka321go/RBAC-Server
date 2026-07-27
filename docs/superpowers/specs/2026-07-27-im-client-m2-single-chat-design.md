# IM 客户端 M2 · 单聊文本闭环 设计方案

> 状态：已通过头脑风暴评审（2026-07-27）。
> 上游：`docs/superpowers/specs/2026-07-27-im-client-rn-portable-design.md`（客户端总设计，M0/M1 已完成）。
> 接口契约：`docs/10-IM接口文档.md`（REST `:8080/api`，WebSocket `:9001/im`）。

## 目标

打通单聊文本的收发闭环：`SEND` + clientMsgId 乐观写库 → `ACK` → 自己的 `PUSH` 对账回填 → 落 SQLite；接收他人 `PUSH` 落库。UI 交付登录后的选人页与会话页（inverted FlatList + 输入栏）。验收标准：A↔B 两账号在线互发文本，杀进程重开消息仍在。

M1 已交付登录、WS 长连接（心跳/看门狗/退避重连）、连接状态条。M2 是第一次在真机上真正落 SQLite。

## 已决策（头脑风暴结论）

1. **本地库本期直接接 op-sqlite**，不做内存过渡实现。M2 的"本地优先"验收必须是真的，否则 M3 做离线同步时还要再动一次原生构建。
2. **未确认消息放独立 `outbox` 表**，不占用 `messages` 的 `(cid, seq)` 主键空间。真实 seq 空间保持干净，M3 的 `sinceSeq = 本地 maxSeq` 不会被占位行污染。
3. **发送可靠性 = 手动重发 + ACK 超时**。自动重发队列留 M3（它与 M3 的重连补拉是同一个触发点）。
4. **选人页接 RBAC 用户列表**（`GET /api/system/users`），带手动输入 userId 的降级兜底。
5. **导航装 React Navigation native-stack**（spec 已定选型），与 op-sqlite 一并完成原生重编。

---

## 一、本地存储变更

`store/migrations.ts` 的 `MIGRATIONS` 数组追加两项（版本号 = 数组下标，`runMigrations` 幂等，旧库自动补）：

```sql
CREATE TABLE outbox (
  client_msg_id TEXT PRIMARY KEY,   -- 幂等键；重发复用同一个
  cid           TEXT NOT NULL,
  type          TEXT NOT NULL,      -- M2 只有 TEXT
  body_json     TEXT,
  status        TEXT NOT NULL,      -- sending | acked | failed
  error         TEXT,               -- ERROR.body.reason / OFFLINE / ACK_TIMEOUT
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_outbox_cid_created ON outbox (cid, created_at);
```

`messages` / `conversations` / `sync_meta` 三张表结构不变。

### outbox 状态机

```
             ┌─ 未连接 ────────────────────────► failed(OFFLINE)
sendText ──► sending ─── 15s 无 ACK ───────────► failed(ACK_TIMEOUT)
             │   └─ 收 ERROR{clientMsgId} ─────► failed(reason)
             └─ 收 ACK ──► acked ─┐
                                  ├─ 收自己的 PUSH{clientMsgId} ─► 行被删除，消息进 messages
                 sending ─────────┘   （PUSH 可能先于 ACK 到达，两状态都要能对账）

failed ── resend（复用同一 clientMsgId）──► sending
```

---

## 二、组件划分

| 单元 | 职责 | 依赖 |
|------|------|------|
| `OutboxStore`（`store/outboxStore.ts`） | outbox 的增删改查；读路径拼接 `getChatMessages` | `Database` |
| `ChatService`（`chat/chatService.ts`，新） | 发送编排（生成 clientMsgId → 写 outbox → 发帧 → ACK 超时 → ERROR 标失败 → 重发）；同时是**下行帧路由器**（`PUSH`→引擎、`ERROR`→标失败、其余忽略） | `ConnectionManager`、`SyncEngine`、`OutboxStore`、`Ids` |
| `SyncEngine.applyPush()`（扩展 M0 的壳） | Envelope→StoredMessage 归一；事务内落库 + 删对账掉的 outbox 行 + 前向单调推进位点 | `MessageStore`、`OutboxStore`、`Emitter` |
| `AuthService.fetchMe()` | `GET /auth/me` 取当前用户 id 并缓存；cid 拼接与"己方气泡"判定都要它 | `Http` |
| `OpSqliteDatabase`（`@im/sdk-rn`） | `Database` 端口的 op-sqlite 实现（exec / query / tx） | op-sqlite |

`ChatService` 是唯一订阅 `connection` 的业务单元，`SyncEngine` 只认数据不认连接——保证 core 的落库逻辑能被 M3 的 REST 拉取直接复用。

### 对外接口

```ts
class ChatService {
  sendText(cid: string, text: string): Promise<string>;   // 返回 clientMsgId
  resend(clientMsgId: string): Promise<void>;             // 复用同一 clientMsgId
  getChatMessages(cid: string): Promise<ChatMessage[]>;  // 委托 OutboxStore 的拼接查询
  on(event: 'message' | 'conversation' | 'sendError', fn): () => void;
}

interface ChatMessage {
  cid: string;
  seq: number | null;          // null = 仍在 outbox（待发/失败）
  clientMsgId: string | null;
  msgId: string | null;
  senderId: number | null;     // outbox 行为 null（本机待发）
  type: string;
  body: Record<string, unknown> | null;
  recalled: boolean;
  status: 'sent' | 'sending' | 'acked' | 'failed';
  error: string | null;
  ts: number;
}
```

---

## 三、数据流

### 发送 `sendText(cid, text)`

```
1. clientMsgId = ids.uuid()
2. INSERT outbox(status='sending', created_at=ids.now()) → emit message{cid}   ← UI 立刻出气泡
3. connection.getState() !== 'connected' → status='failed', error='OFFLINE' → emit，结束
4. connection.send({ op:SEND, cid, clientMsgId, type:'TEXT', body:{ text } })
5. 起 15s 计时器：到点该行仍为 sending → failed('ACK_TIMEOUT') → emit
   （若此时 PUSH 已先到把行删掉，条件更新影响 0 行，无副作用）
6. 收 ACK{clientMsgId} → 清计时器，status='acked'（UI 仍显示"发送中"）
7. 收自己的 PUSH{clientMsgId, seq} → 走 applyPush，outbox 行消失、真实消息行出现
```

`resend(clientMsgId)` 读回 outbox 行，**复用同一个 clientMsgId** 重走 3–6（服务端对 clientMsgId 幂等，重发不会产生重复消息）。

### 接收 `applyPush(env)`（己方回声与他人消息同一条路径）

```
校验 env.cid / env.seq 存在，否则整帧丢弃（脏帧不炸线程）
tx {
  upsertMessage(cid, seq, msgId, clientMsgId, senderId, type, body, status='sent', ts)
      -- (cid, seq) 冲突即幂等覆盖，扛 Kafka 重投与将来的重连重复拉取
  if (env.clientMsgId) DELETE FROM outbox WHERE client_msg_id = ?      -- 发送对账
  conversations.last_msg_seq = max(旧值, seq)  -- 前向单调，乱序到达不回退
  conversations.last_msg_preview / updated_at 一并更新
  sync_meta.synced_seq       = max(旧值, seq)  -- M3 的拉取起点，M2 就维护好
}
emit message{cid} + conversation{cid}
```

### 读路径

`getChatMessages(cid)` = `messages`（seq ASC）++ `outbox`（created_at ASC），归一成 `ChatMessage[]`。待发消息恒在真实消息之后，UI 拿到的就是正确时间序，无需自己合并。

---

## 四、UI（app-mobile）

导航改为 React Navigation native-stack，三屏：`Login` → `Contacts` → `Chat`。

**Contacts（选人页）**
- `GET /api/system/users?page=&pageSize=&nickname=` 渲染列表（过滤掉自己），点击 → `navigate('Chat', { peerId })`，cid 本地拼 `c_<min>_<max>`。
- **降级必做**：该接口需要 `system:user:list` 权限**且受数据权限过滤**，非管理员账号可能 403 或只看到本部门。403 / 空列表时给出提示，并提供"直接输入对端 userId"的兜底输入框。

**Chat（会话页）**
- inverted `FlatList`（数据反转后喂入）+ 底部输入栏（空串不发），顶部复用现有 `ConnectionStatusBar`。
- 己方右气泡 / 对端左气泡，判定：`seq == null || senderId === myId`。
- 状态角标：`sending` / `acked` 转圈；`failed` 红感叹号，点击触发 `resend`；`sent` 无标记。
- 刷新策略：订阅 SDK `message` 事件，cid 命中即重查该会话全量（M2 消息量小；分页/增量渲染留后续里程碑）。

**装配**：`createSdk` 内部需要 open op-sqlite 并跑迁移（异步），仍同步返回对象，额外暴露 `ready: Promise<void>`；App 启动时 await `ready` 再进登录页。

---

## 五、错误处理

| 情形 | 行为 |
|------|------|
| `ERROR{clientMsgId, reason}` | outbox 标 `failed(reason)` + emit `sendError{cid, clientMsgId, reason}` → UI toast。M2 实际只会碰到 `NOT_MEMBER` |
| 未连接时发送 | `failed('OFFLINE')`，不发帧 |
| 15s 内无 ACK | `failed('ACK_TIMEOUT')`；若 ACK 已先到，超时回调不得再改状态 |
| 脏帧（非 JSON / 缺 cid、seq） | `ConnectionManager`（JSON 解析）与 `applyPush`（字段校验）两层各自丢弃，不影响连接 |
| REST 401 | 沿用 M1 现状：直接抛出，UI 回登录页 |

**已知边界（M2 不修，记录在案）**

- 收到 `ACK` 但 `PUSH` 永久丢失时，outbox 行会停在 `acked` 不动。M3 的重连补拉会按 clientMsgId 把它对账掉。
- 401 刷新单飞（客户端总设计错误处理一节提到）M1 未做，M2 不扩，列为 follow-up。

---

## 六、测试策略

### core（Node + sql.js + 假 Transport + 假定时器）

1. 迁移建出 `outbox` 表；对已有旧库重复调用 `runMigrations` 幂等。
2. `sendText` 写 outbox `status='sending'`，并发出符合契约的 `SEND` 帧（断言帧字段）。
3. 未连接时 `sendText` → `failed('OFFLINE')`，且不发帧。
4. 收 `ACK` → `status='acked'`，超时计时器被清除。
5. 15s 无 ACK → `failed('ACK_TIMEOUT')`。
6. ACK 先到、随后超时触发 → 状态保持 `acked` 不被改写。
7. `ERROR{clientMsgId, reason}` → `failed(reason)` + `sendError` 事件。
8. `resend` 复用同一 clientMsgId 重发。
9. `applyPush` 己方消息 → messages 插入且 outbox 行在**同一事务内**删除。
10. `applyPush` 他人消息 → 落库 + `message`/`conversation` 事件。
11. 重复投递同 `(cid, seq)` → 幂等，库中仍只有一行。
12. 乱序 PUSH（seq 43 先于 42 到达）→ `last_msg_seq` / `synced_seq` 不回退。
13. 缺 `cid` 或 `seq` 的脏 PUSH → 丢弃，不写库不发事件。
14. `getChatMessages` 拼接顺序：真实消息（seq ASC）在前，待发（created_at ASC）在后。

### 适配器

`OpSqliteDatabase` 无法在 Node 内运行，本期**不做自动化契约测试**（需真机 runner），由端到端手测覆盖；`Database` 契约用例集抽成可复用数组，将来接真机 runner 直接套用。

### 端到端手测（Android 模拟器双实例，两个账号）

1. A 发送 → 本地立刻出现 `sending` 气泡 → 变 `sent`；B 在线收到。
2. 停掉网关后发送 → `failed` → 恢复网关后点重发成功，**且 B 侧不出现重复消息**（幂等验证）。
3. 杀 App 重开：已 `sent` 的消息仍在（SQLite 持久化），`failed` 的也仍在且可重发。

**准备事项**：端到端需要第二个可登录账号，通过 RBAC 前端页面创建（不写 SQL、不直调接口）。

---

## 七、范围外（后续里程碑）

- `GET /im/messages` 增量拉取、会话列表、未读计算（M3）
- 群聊（M4）、富媒体（M5）、链接卡片（M6）、撤回（M7）、@提及（M8）、已读回执（M9）
- 自动重发队列、消息分页加载、REST 401 刷新单飞、Detox 自动化
