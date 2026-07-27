# IM 后端 MVP · 第八阶段（里程碑10：已读未读 / 已读回执）设计

- Base（起点）：`b101dd7`（里程碑9 @提及 完成点）
- 分支：`feat/im`（长期集成分支）
- 总设计：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` §「已读未读 / 离线 / 多端同步」/「分阶段实施里程碑」第 10 项
- 执行方式：本会话内逐任务 TDD（沿用里程碑8/9，成本考量，不派 subagent）

## 决策（用户已定 2026-07-27）

1. **群聊只维护未读数，不扇出成员级回执**：群聊每人只前向推进自己的 `last_read_seq`（未读数/「有人@我」标记随之消除），不向其他成员广播「谁读到哪」。**仅单聊**在读位点推进后向对端扇出已读回执。避免群聊「已读回执风暴」（N 成员 × 每次已读 = N² 帧）。
2. **上报走 Kafka `op=READ`，复用 im-inbound 分支**：与 `RECALL` 完全同构，不新增 REST。客户端 → 网关 WebSocket → Kafka `im-inbound`，`InboundMessageConsumer` 按 op 分支路由到 `ReadService`。
3. **会话 VO 暴露 `peerReadSeq`（仅单聊）保证重连一致**：已读回执是瞬时控制帧（不落库、不占 seq），对端离线即丢。对端的 `last_read_seq` 本身持久化在 MySQL，故会话列表 VO 为单聊额外带一个 `peerReadSeq`（对端已读位点），重连拉会话列表即可恢复「对方已读到 N」。群聊 `peerReadSeq=null`。

## 现状（已就位，本期只补逻辑）

- `im_conversation_member.last_read_seq BIGINT NOT NULL DEFAULT 0`（V3 迁移）——已建。
- `ImConversationMember.lastReadSeq` 实体字段——已有。
- `ConversationService.listMyConversations` 已用 `last_read_seq` 算 `unreadCount = max(0, lastMsgSeq - lastReadSeq)`、`hasMention = mentionSeq > lastReadSeq`——**读侧已消费，缺的是推进入口 + 回执扇出**。
- `ImConversationMemberMapper.advanceMentionSeq(cid, userIds, seq)`——里程碑9 的前向单调推进 SQL，`advanceReadSeq` 照此单用户裁剪。
- `ConversationService.isMember(cid,userId)` / `memberUserIds(cid)` / `groupIdFromCid(cid)`——已有。
- `OutboundDispatcher.dispatchToUser(userId, env)`——定向推单用户所有在线设备，回执扇出复用它。
- `InboundMessageConsumer` 已有 `RECALL` op 分支的先例（`if ("RECALL".equals(env.getOp())) { ...; return; }`）。

## 上行 body 约定

`op=READ` 的 `Envelope`：
- `cid`：会话 id
- `senderId`：阅读者 userId（复用发送者字段语义 = 动作发起者）
- `body.readSeq`：已读到的消息 seq（Number）

## 组件与数据流

### 1. `ReadService`（新增，同构 `RecallService`/`MentionService`）

`void read(Envelope env)`：

1. **成员校验**：`!isMember(cid, readerId)` → 静默 `return`（被动阅读，非成员不回 ERROR，避免噪声/探测面）。
2. **解析 readSeq**：`body.get("readSeq")` 非 Number（含 null/缺失）→ 静默 `return`。
3. **钳制**：`effective = min(readSeq, conversation.last_msg_seq)`。防止客户端上报超大 seq 把未来消息永久标记已读（`unreadCount` 恒 0）——真实正确性风险。会话不存在（理论不可达，成员校验已过）按不推进处理。
4. **前向单调推进**：`int rows = memberMapper.advanceReadSeq(cid, readerId, effective)`。仅当 `last_read_seq < effective` 才更新（只增不减，天然幂等，扛 Kafka 重投 + 多端重复上报）。
5. **扇出（仅单聊且确实推进）**：`rows > 0 && groupIdFromCid(cid) == null` 时，对 `memberUserIds(cid)` 中**排除阅读者**的成员（单聊恰好 1 人）`dispatchToUser` 一帧 `op=READ, cid, senderId=readerId, body={readSeq: effective}`。
   - 群聊（`groupId != null`）：只推进，**不扇出**。
   - 未推进（`rows == 0`，重复/过期上报）：**不扇出**（避免冗余回执）。

### 2. `ImConversationMemberMapper.advanceReadSeq`（新增 `@Update`）

```sql
UPDATE im_conversation_member SET last_read_seq = #{seq}
WHERE cid = #{cid} AND user_id = #{userId} AND last_read_seq < #{seq}
```
返回受影响行数（`int`），供 `ReadService` 判定是否扇出。

### 3. `InboundMessageConsumer`（接线）

在 `RECALL` 分支旁新增（READ 不落库、不占 seq、不走幂等/成员/媒体/@提及校验链）：
```java
if ("READ".equals(env.getOp())) {
    readService.read(env);
    return;
}
```

### 4. `ConversationService.listMyConversations`（填 peerReadSeq）

- 收集当前用户的**单聊** cid 集合；一条查询 `member 行 WHERE cid IN(单聊cids) AND user_id != me`，映射 `cid → 对端 last_read_seq`。
- 单聊 VO：`peerReadSeq = 对端 last_read_seq`；群聊 VO：`peerReadSeq = null`。
- `ImConversationVO` 新增字段 `Long peerReadSeq`（可空，群聊/无对端为 null）。

## 不需要

- 新迁移（`last_read_seq` 列已存在）
- 新配置项
- 新 HTTP 端点（上报走 Kafka op=READ，回执走 Kafka out）
- `OutboundDispatcher` 新方法（复用 `dispatchToUser`）
- 改动消息正文 / MessageAppender / MessageQueryService

## 测试（TDD，沿用 IM 测试风格）

硬编码 id 的清理用**物理删除**（规避 `uk_cid_user` 不含 deleted 的已知坑）。

- **`ReadServiceTest`**：
  - 前向推进：`last_read_seq` 由 0 → readSeq。
  - 过期/更低 seq：`last_read_seq` 不动、不扇出（`rows==0`）。
  - 超大 readSeq：钳制到会话 `last_msg_seq`。
  - 非成员：no-op（不推进、不扇出、不抛）。
  - 缺失/非法 readSeq：no-op。
  - 单聊：推进后向对端 `dispatchToUser` 一帧 `op=READ`（排除阅读者）。
  - 群聊：只推进，`dispatcher` **never** 扇出。
  - 重复上报（第二次同 seq）：无二次扇出。
- **`InboundMessageConsumer` READ 分支**：`op=READ` 路由到 `readService.read(env)` 并 `return`（不调 `appender.append`）。
- **`ConversationService` peerReadSeq**：单聊 VO 带对端 `last_read_seq`；群聊 VO `peerReadSeq == null`。
- **端到端**：A 发消息(seq S) → B 上报 `op=READ, readSeq=S` → B `last_read_seq=S`、B 会话未读归 0；回执 `op=READ` 扇出给 A；A 会话列表 VO `peerReadSeq == S`。

## 里程碑 11（压测）说明

里程碑 11（压测客户端模拟 N 万连接 + QPS + 观测报告）性质迥异（需活的网关/Kafka/Redis 基建、压测客户端、产出观测报告，非 TDD 代码功能），**待里程碑 10 落地并整支评审通过后单独确认范围**，不在本 spec 内。
