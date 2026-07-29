# IM 后端 MVP — 第二阶段设计：离线消息 + 多端同步（里程碑 4）

> 状态：已通过头脑风暴评审（2026-07-23）。
> 上游设计：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md`（11 个里程碑，本文只覆盖里程碑 4）。
> 前置：Phase 1（里程碑 1~3，Task 1~12）已完成——Maven 多模块、Netty 网关握手鉴权、单聊文本闭环（上行→Kafka→定序→MongoDB→下行→在线推达）。
> 分支：`feat/im`（集成干线）。

## 背景（为什么做、做什么）

Phase 1 打通了"在线"链路：两端都在线时 A 发 B 收。但只要接收端离线、或用户换了/新增设备，消息就无法补齐——因为客户端还没有"上线后把落在 MongoDB 里、自己 `seq` 位点之后的消息拉回来"的能力。

里程碑 4 补上这一环：**离线消息 = 多端同步 = 增量拉取**，统一靠 per-conversation `seq` 位点实现。客户端本地维护每个会话的 `syncedSeq`，上线后：

1. 先发现"哪些会话有新消息"（会话列表同步）。
2. 再对有差异的会话增量拉取 `seq > syncedSeq` 的消息。

离线期间攒下的消息、别的设备发的消息，走完全相同的一套逻辑。

**范围约束**：纯 backend REST，复用现有 Spring Security + JWT 过滤器鉴权。**im-gateway（Netty 网关）不改动**，Kafka/WS 实时推送链路不受影响。

## 传输选型（已决策）

`pull(cid, sinceSeq)` 走 **REST（在 backend）**，不走 WS 指令。理由：

- 请求/响应式查询天然适合增量拉取（可分页、可缓存、幂等）。
- 直接复用 backend 现有 `JwtAuthenticationFilter` + `SecurityFilterChain`，无需在网关侧重复实现查询、分页与背压。
- MockMvc 好测，边界清晰。

WS 通道继续只承担实时推送（Phase 1 已建），不承载查询职责。

---

## REST 接口设计

统一前缀 `/api`、camelCase、枚举固定字符串（会话类型 `SINGLE`/`GROUP`）。两个接口均经现有 JWT 过滤器鉴权，从 `SecurityContext` 取当前 `userId`。

### A. `GET /api/im/conversations` — 我的会话列表同步

让客户端发现"哪些会话有新消息"。

- **数据源**：`im_conversation` join `im_conversation_member`（`user_id` = 当前用户、`deleted=0`）。
- **响应**：`Result<List<ImConversationVO>>`

```json
{
  "code": 200, "message": "success",
  "data": [
    {
      "cid": "c_1_2",
      "type": "SINGLE",
      "groupId": null,
      "lastMsgSeq": 42,
      "lastMsgPreview": "在吗",
      "lastReadSeq": 40,
      "unreadCount": 2
    }
  ]
}
```

- `unreadCount = max(0, lastMsgSeq - lastReadSeq)`。
- `lastReadSeq` 来自 `im_conversation_member`，**只读展示**；已读**上报**（`read(cid, seq)` 更新 `last_read_seq`）属里程碑 10，本期不做。
- 客户端据 `lastMsgSeq` 与本地 `syncedSeq` 对比，挑出有差异的会话去拉消息。

### B. `GET /api/im/messages?cid=&sinceSeq=&limit=` — 单会话增量拉取

- **入参**：`cid`（必填）、`sinceSeq`（选填，缺省 0）、`limit`（选填，缺省 50，上限 200；超限则夹到 200）。
- **成员校验**（安全红线）：调用者必须是 `cid` 成员，否则返回 403（`BusinessException` + `GlobalExceptionHandler`）。数据权限不可绕过。
- **查询**：MongoDB 取 `cid` 下 `seq > sinceSeq` 的消息，按 `seq` **升序**，取 `limit + 1` 条判断是否还有更多。
- **响应**：`Result<PullResult>`

```json
{
  "code": 200, "message": "success",
  "data": {
    "messages": [
      { "cid": "c_1_2", "seq": 41, "msgId": "...", "senderId": 1,
        "type": "TEXT", "body": {"text": "在吗"}, "recalled": false, "ts": 1690000000000 }
    ],
    "hasMore": true,
    "nextSinceSeq": 41
  }
}
```

- `hasMore`：本批取满 `limit` 且还有更多（靠多取 1 条判断）。
- `nextSinceSeq`：本批最后一条的 `seq`；客户端下次带此值继续，直到 `hasMore=false`。
- `sinceSeq` 空视为 0（从头拉，受 `limit` 分页）。
- `ImMessageVO` 不回传 `clientMsgId`（发送端去重用，接收端无需）。

### 数据流（端到端）

```
客户端上线
  → GET /api/im/conversations           拿各会话 lastMsgSeq
  → 与本地 syncedSeq 比较，挑出有差异的会话
  → for each 差异会话:
       GET /api/im/messages?cid&sinceSeq=syncedSeq&limit=50
       循环带 nextSinceSeq 直到 hasMore=false
  → 更新本地各会话 syncedSeq
```

离线消息与其他设备发的消息，均由此统一覆盖。

---

## 组件（backend `com.rbac.im`，新增/修改）

| 层 | 类 | 职责 |
|----|----|------|
| controller | `ImConversationController` | `GET /api/im/conversations` |
| controller | `ImMessageController` | `GET /api/im/messages` |
| service | `ConversationService`（扩展） | `listMyConversations(userId)`、`isMember(cid, userId)` |
| service | `MessageQueryService`（新增） | 成员校验 + 增量拉取 + 组装 `PullResult` |
| vo | `ImConversationVO` | 会话列表项 |
| vo | `ImMessageVO` | 消息项（不含 `clientMsgId`） |
| vo | `PullResult` | `{messages, hasMore, nextSinceSeq}` |
| repo | `ImMessageRepository`（扩展） | 带 `limit` 的按 seq 升序分页查询（如 `findByCidAndSeqGreaterThanOrderBySeqAsc(cid, seq, Limit)` 或 `Pageable`） |

- 当前 `ImMessageRepository.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, seq)` 无分页；扩展一个带 `limit` 的重载（Spring Data `Limit`/`Pageable`），拉 `limit + 1` 条用于 `hasMore` 判断。
- `ConversationService` 已有 `memberUserIds(cid)`，`isMember` 可基于它或直接 `count` 查询。

---

## 安全与边界

- **成员校验不可绕过**：`GET /messages` 与（隐式的）会话列表都只返回当前用户参与的会话数据；非成员访问 `cid` 返回 403。列表接口天然按 `user_id` 过滤，无越权面。
- **只读**：本期两个接口都是查询，不写库、不改位点。
- **本期不做**（后续里程碑）：撤回、富媒体（IMAGE/AUDIO/FILE）、@提及、链接卡片、已读上报。消息 `type` 目前只有 `TEXT`；`recalled` 字段透传但恒 `false`。
- **只做 forward（离线增量）**：`seq > sinceSeq` 向新拉取；不做 history 回溯（拉 `seq < x` 的更早消息）——那是独立特性，留后续。

---

## 测试

沿用 `@SpringBootTest @ActiveProfiles("test")`（连 `rbac_test` MySQL + `rbac_im` MongoDB + Redis），配合 MockMvc：

- **会话列表**：造两条会话 + 成员位点，断言 `unreadCount = lastMsgSeq - lastReadSeq`、只返回当前用户参与的会话。
- **增量拉取正确性**：写入 seq 1..5，`sinceSeq=2` 只返回 3/4/5，升序。
- **分页 hasMore**：写入 5 条、`limit=2`，断言首批 2 条 + `hasMore=true` + `nextSinceSeq`；带 `nextSinceSeq` 续拉直到 `hasMore=false`。
- **成员校验 403**：非成员用户拉取某 `cid` 返回 403。
- **默认值**：`sinceSeq` 缺省视为 0；`limit` 超 200 夹到 200。
- Mongo 测试可重复：用例开头先按 `cid` 清理旧数据（沿用 `ImMessageRepositoryTest` 约定）。

---

## 验证方式（手动，可选）

起中间件 + backend 后，用现有登录接口拿两个用户的 access token：

1. 用户 A、B 建立单聊并发几条消息（Phase 1 WS 路径，或直接造数据）。
2. `curl -H "Authorization: Bearer <B的token>" /api/im/conversations` → 看到会话与 `unreadCount`。
3. `curl .../api/im/messages?cid=c_1_2&sinceSeq=0&limit=2` → 分页拉取，带 `nextSinceSeq` 续拉。
4. 用非成员 token 拉同一 `cid` → 403。

---

## 已决策汇总

- Phase 2 范围 = **仅里程碑 4**（离线 + 多端同步）；群聊、已读上报、富媒体等留后续 Phase。
- 传输 = **REST（backend）**，复用现有 JWT 鉴权；网关不动。
- 包含**会话列表同步接口**（多端同步的发现环节），非仅单会话 pull。
- 拉取只做 forward 增量、只读；成员校验强制。
