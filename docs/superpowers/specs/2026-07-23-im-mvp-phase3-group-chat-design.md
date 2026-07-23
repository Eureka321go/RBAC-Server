# IM 后端 MVP — 第三阶段设计：群聊（里程碑 5）

> 状态：已通过头脑风暴评审（2026-07-23）。
> 上游设计：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md`（11 个里程碑，本文只覆盖里程碑 5）。
> 前置：Phase 1（里程碑 1~3）单聊文本闭环、Phase 2（里程碑 4）离线 + 多端同步已完成。
> 分支：`feat/im`（集成干线）。

## 背景（为什么做、做什么）

Phase 1/2 打通了单聊的在线收发、离线补齐与多端同步。里程碑 5 引入**群聊**。

关键洞察：**扇出、会话列表、增量拉取已经是通用的，群聊不需要改它们**。

- `OutboundDispatcher.dispatch(cid)` 按 `memberUserIds(cid)` 读扩散给全体成员，与单聊/群聊无关。
- `ConversationService.listMyConversations`、`GET /api/im/messages` 对 GROUP 会话同样生效，`ImConversationVO` 已带 `groupId`。
- V3 迁移已建 `im_group`、`im_group_member`、`im_conversation(type/group_id)`、`im_conversation_member`。

因此本期真正的工作是一层新东西 + 两处缺口修补：

1. **群生命周期管理层**：建群/加成员/踢人/退群/解散/改名/转让群主/设免管理员/禁言 + 角色权限校验，并把群会话接进已有的发送/拉取/列表链路。
2. **发送成员校验（安全红线）**：现在无人校验 `senderId ∈ cid`，任何人可往任意 cid 发消息；群聊放大越权面，本期在 logic 层堵上，并叠加群禁言拦截。
3. **修 Phase 1 遗留缺口**：`InboundMessageConsumer` 存了消息但没更新 `im_conversation.last_msg_seq/preview`，导致会话列表 `lastMsgSeq` 恒为 0。本期抽取共享写入组件时一并补上。

**范围约束**：群管理走 backend REST，复用现有 Spring Security + JWT 过滤器鉴权。**im-gateway（Netty 网关）不改动**。SYSTEM 系统消息由 backend 内的 `GroupService` 直接经共享写入组件扇出，不经网关上行。

---

## 架构：共享写入组件 + 复用扇出

新增核心组件 **`MessageAppender`**，从现有 `InboundMessageConsumer` 抽取，统一"落库 + 更新会话摘要 + 扇出"：

```
MessageAppender.append(cid, senderId, type, body, clientMsgId):
    seq   = SeqService.nextSeq(cid)          // Redis INCR
    msgId = ULID/UUID
    ts    = now
    保存 ImMessage{cid, seq, msgId, senderId, type, body, clientMsgId, ts}
    更新 im_conversation.last_msg_seq = seq、last_msg_preview = 摘要(type, body)   // 修 Phase 1 缺口
    组装 PUSH Envelope → OutboundDispatcher.dispatch(cid, push)
    return seq/msgId
```

两个调用方：

- **用户消息**：`InboundMessageConsumer`（Kafka 入站）改为 → 幂等判重 → **成员/禁言校验** → `MessageAppender.append(...)`。
- **SYSTEM 消息**：`GroupService` 生命周期操作成功后 → `MessageAppender.append(cid, operatorId, "SYSTEM", body, null)`。

`last_msg_preview` 按类型生成摘要：`TEXT` 取 `body.text`（限长）、`SYSTEM` 取事件对应文案。

---

## 发送成员校验（安全红线）

网关无 DB、不校验；校验落在 logic 层 `InboundMessageConsumer`，在 `MessageAppender.append` 之前：

1. `senderId` 必须是 `cid` 成员（`ConversationService.isMember`），否则丢弃 + WARN 日志。
2. 群会话再查发送者在 `im_group_member` 是否被禁言（`muted=1`），是则丢弃。
3. **被拒回执**：向发送者自己的路由（`route:user:<senderId>`）推一条 `op=ERROR` 的 Envelope（`body.reason = NOT_MEMBER / MUTED`），客户端提示"你已被禁言 / 不在群"。
   - 网关此前已回过 `ACK`（"服务器已接收"），故这是 ACK 之后再补一条错误帧，客户端据 `clientMsgId` 把该消息标记为发送失败。

会话级免打扰（`im_conversation_member.muted`）**不拦截发送**，只影响接收端红点/通知强度（本期只透传字段，通知策略留后续里程碑）。

---

## 数据模型变更（V4 迁移）

```sql
ALTER TABLE `im_group_member`
    ADD COLUMN `muted` TINYINT NOT NULL DEFAULT 0 COMMENT '群级禁言：1=被管理员禁言，发送时拦截';
```

- **群级禁言** = `im_group_member.muted`（管理员设，发送链路拦截）。
- **会话级免打扰** = 现有 `im_conversation_member.muted`（用户自设，只影响自己红点，不拦发送）。二者语义不同、字段不同。
- **成员上限**：配置项 `rbac.im.group-max-members`（默认 500）。加成员前 `count(im_group_member where group_id, deleted=0)` 校验，不加冗余计数列。
- **群 cid**：`g_{groupId}`。建群时插 `im_conversation(cid, type=GROUP, group_id, last_msg_seq=0)` + 每个成员一行 `im_conversation_member(last_read_seq=0, mention_seq=0, muted=0)`。

`im_group_member` 与 `im_conversation_member` 在同一事务内保持同步：成员加入 → 两表各插一行；成员离开/被踢 → 两表各软删一行（`@TableLogic`, `deleted=1`）。

### 权限矩阵（Service 层业务二次校验，非 RBAC 权限码）

群操作是终端用户功能，不挂 `@PreAuthorize('hasAuthority(...)')` 权限码；只需登录态 + Service 层群角色校验。

| 操作 | 谁可以 | 说明 |
|------|--------|------|
| 建群（选初始成员） | 任意登录用户 | 创建者 = OWNER |
| 加成员 | OWNER / ADMIN | 受成员上限约束；重复加幂等跳过 |
| 踢人 | OWNER 踢任何人；ADMIN 只能踢 MEMBER | 不能踢 OWNER；不能踢自己（用退群） |
| 退群 | 除 OWNER 外任意成员 | OWNER 须先转让或解散 |
| 解散 | 仅 OWNER | |
| 改名 | OWNER / ADMIN | |
| 转让群主 | 仅 OWNER | 目标须为现有成员；原群主降为 MEMBER |
| 设 / 免管理员 | 仅 OWNER | 目标须为 MEMBER↔ADMIN |
| 禁言 / 解禁成员 | OWNER / ADMIN，只能管 MEMBER | 写 `im_group_member.muted` |
| 查成员列表 / 群详情 | 任意成员 | 非成员 403 |

权限校验失败 → `BusinessException` + `GlobalExceptionHandler`（403），文案走 i18n。

---

## SYSTEM 系统消息

全部生命周期事件各发一条 `type="SYSTEM"` 消息，经 `MessageAppender` 正常扇出 + 落库，离线端可增量拉到。

`body` 结构：`{ "event": "...", "operatorId": <操作者>, "targetIds": [<被操作者>], "extra": {...} }`

| event | 触发 | extra |
|-------|------|-------|
| `GROUP_CREATE` | 建群 | `{name}` |
| `MEMBER_JOIN` | 加成员 | — |
| `MEMBER_LEAVE` | 退群 | — |
| `MEMBER_KICK` | 踢人 | — |
| `GROUP_DISSOLVE` | 解散 | — |
| `GROUP_RENAME` | 改名 | `{oldName, newName}` |
| `OWNER_TRANSFER` | 转让群主 | — |
| `ADMIN_CHANGE` | 设 / 免管理员 | `{role}` |
| `MEMBER_MUTE` | 禁言 / 解禁 | `{muted}` |

客户端据 `event` + `operatorId/targetIds` 渲染灰字提示（如"X 加入了群聊"）。服务端只存结构化数据，不硬编码展示文案（i18n 交客户端）。`last_msg_preview` 服务端可生成一版默认中文摘要用于会话列表。

### 判断点决议

- **新成员历史可见性**：读扩散下新成员 `pull(sinceSeq=0)` 可看入群前全部历史（贴合模型、最简单）。加入时把其 `last_read_seq` 初始化为当前 `last_msg_seq`，避免一进群巨量未读。企业微信式"入群不可见历史"留后续。
- **解散时机**：先发 SYSTEM `GROUP_DISSOLVE` 扇出给在线成员，再同事务软删 `im_group` / `im_group_member` / `im_conversation` / `im_conversation_member`。**已知局限**：解散当刻离线的成员因成员行已软删而拉不到该通知。学习 MVP 接受此局限。

---

## REST 接口（`/api/im/groups`，JWT 鉴权，camelCase）

```
POST   /api/im/groups                              建群   {name, memberIds[]}     → {groupId, cid}
GET    /api/im/groups/{groupId}                    群详情  → {groupId, name, ownerId, memberCount, myRole}
GET    /api/im/groups/{groupId}/members            成员列表 → [{userId, role, muted}]
POST   /api/im/groups/{groupId}/members            加成员  {userIds[]}
DELETE /api/im/groups/{groupId}/members/{userId}   踢人
DELETE /api/im/groups/{groupId}/members/me         退群
PATCH  /api/im/groups/{groupId}                     改名   {name}
POST   /api/im/groups/{groupId}/owner              转让   {newOwnerId}
PUT    /api/im/groups/{groupId}/members/{userId}/role   设/免管理员 {role: ADMIN|MEMBER}
PUT    /api/im/groups/{groupId}/members/{userId}/mute   禁言/解禁   {muted: true|false}
DELETE /api/im/groups/{groupId}                     解散
```

- 全部经现有 `JwtAuthenticationFilter`，从 `SecurityContext` 取当前 `userId`。
- 统一响应 `Result<T>`；错误走 `BusinessException` + i18n。
- 角色/成员枚举固定字符串：`OWNER` / `ADMIN` / `MEMBER`；会话类型 `SINGLE` / `GROUP`。

---

## 组件（backend `com.rbac.im`，新增/修改）

| 层 | 类 | 职责 |
|----|----|------|
| controller | `ImGroupController`（新增） | 上述 11 个群管理接口 |
| service | `GroupService`（新增） | 生命周期 + 权限校验 + 成员上限 + 双表同步 + 发 SYSTEM 消息，事务边界 |
| service | `MessageAppender`（新增，抽取） | 定序 + 落库 + 更新会话摘要 + 扇出；用户消息与 SYSTEM 消息共用 |
| service | `InboundMessageConsumer`（改） | 幂等 → 成员/禁言校验 → 调 `MessageAppender`；被拒回 ERROR 帧 |
| service | `ConversationService`（扩展） | 新增 `ensureGroupConversation(groupId, memberIds)`；复用 `isMember/memberUserIds` |
| service | `OutboundDispatcher`（复用） | 不改；ERROR 帧的定向推送可复用其按路由投递逻辑 |
| mapper | `ImGroupMapper` / `ImGroupMemberMapper`（复用/扩展） | 群与群成员读写 |
| vo | `ImGroupVO` | 群详情 |
| vo | `ImGroupMemberVO` | 成员项 `{userId, role, muted}` |
| vo | `CreateGroupResult` | `{groupId, cid}` |
| 迁移 | `V4__im_group_member_muted.sql` | 加 `muted` 列 |
| 配置 | `rbac.im.group-max-members`（默认 500） | 成员上限 |
| i18n | `messages*.properties` | 权限/校验错误文案 |

---

## 安全与边界

- **发送成员校验不可绕过**：非成员或被禁言者的上行消息在 logic 层丢弃，绝不落库/扇出。
- **群操作权限二次校验**：前端隐藏只是体验，Service 层强制角色校验，越权返回 403。
- **数据权限**：群详情/成员列表仅群成员可读；建群/加成员对 `memberIds` 仅做存在性与去重，不做好友关系校验（本期无好友系统）。
- **双表事务一致**：`im_group_member` 与 `im_conversation_member` 增删同事务，避免"在群不在会话"或反之。
- **本期不做**（后续里程碑）：富媒体（IMAGE/AUDIO/FILE）、@提及与 `mention_seq` 维护、已读上报回执、链接卡片、撤回、入群不可见历史、会话免打扰的通知抑制、禁言时长（仅布尔禁言）。

---

## 测试

沿用 `@SpringBootTest @ActiveProfiles("test")`（连 `rbac_test` MySQL + `rbac_im` MongoDB + Redis）+ MockMvc：

- **建群**：OWNER 角色正确、双表插入、cid=`g_{id}`、发 `GROUP_CREATE` SYSTEM 消息并落库。
- **加成员**：OWNER/ADMIN 可加、MEMBER 不可（403）、重复加幂等、超上限拒绝、新成员 `last_read_seq` 初始化为当前 `last_msg_seq`、发 `MEMBER_JOIN`。
- **踢人**：OWNER 踢 ADMIN/MEMBER、ADMIN 只能踢 MEMBER、不能踢 OWNER、双表软删、发 `MEMBER_KICK`。
- **退群**：MEMBER/ADMIN 可退、OWNER 不可（须转让/解散）、发 `MEMBER_LEAVE`。
- **转让 / 设免管理员**：仅 OWNER、角色变更正确、发对应 SYSTEM。
- **改名**：OWNER/ADMIN 可、发 `GROUP_RENAME`。
- **解散**：仅 OWNER、先发 `GROUP_DISSOLVE` 再软删四表。
- **禁言**：OWNER/ADMIN 禁言 MEMBER、被禁言者上行被丢弃且收到 `ERROR(MUTED)`、解禁后可发。
- **发送成员校验**：非成员上行被丢弃且收到 `ERROR(NOT_MEMBER)`，不落库。
- **会话摘要**：`MessageAppender` 更新 `last_msg_seq/preview`，`listMyConversations` 群会话 `lastMsgSeq` 非 0（回归 Phase 1 缺口）。
- **扇出复用**：群消息扇给全体在线成员（MockMvc/单测校验 `OutboundDispatcher` 调用）。

网关不改，无需网关侧新测试。

---

## 验证方式（手动，可选）

起中间件 + backend 后，用登录接口拿多个用户 token：

1. A `POST /api/im/groups {name:"测试群", memberIds:[B,C]}` → 得 `groupId/cid`。
2. B、C `GET /api/im/conversations` → 看到群会话；`GET /api/im/messages?cid=g_{id}` → 拉到 `GROUP_CREATE`/`MEMBER_JOIN` SYSTEM 消息。
3. A（或网关 WS 路径）在群里发文本 → B、C 在线收到、离线后 `pull` 补到。
4. A 禁言 B → B 发消息被丢弃并收到 `ERROR`；A 解禁 → B 可发。
5. 非成员 D 拉 `cid=g_{id}` → 403；D 强行 WS 发到该 cid → 丢弃 + `ERROR(NOT_MEMBER)`。
6. A 转让给 B → A 降 MEMBER、B 成 OWNER；A 尝试解散被拒、B 可解散。

---

## 已决策汇总

- Phase 3 范围 = **里程碑 5（群聊），标准 MVP + 进阶**（转让群主、群禁言、全生命周期 SYSTEM 消息、成员上限）。
- 复用现有扇出/列表/拉取；核心新增 `GroupService` + 抽取 `MessageAppender`（顺带修 Phase 1 的 `last_msg_seq` 缺口）。
- 补发送成员校验 + 群禁言拦截（安全红线），被拒回 `ERROR` 帧。
- 群禁言（`im_group_member.muted`）与会话免打扰（`im_conversation_member.muted`）语义分离。
- 新成员可见全量历史但未读清零；解散接受"离线成员漏收解散通知"局限。
- 网关不动；SYSTEM 消息由 backend 直接经 `MessageAppender` 扇出。
