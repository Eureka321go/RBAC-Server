# IM 后端 MVP · 第七阶段（里程碑9：@提及）设计

- Base（起点）：`4173e7c`（里程碑8 完成点）
- 分支：`feat/im`（长期集成分支）
- 总设计：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` §「@提及（群聊）」/「分阶段实施里程碑」第 9 项
- 执行方式：本会话内逐任务 TDD（沿用里程碑8，成本考量，不派 subagent）

## 决策（用户已定 2026-07-27）

1. **校验失败 → 整条拒绝 + ERROR**（不落库、不扇出），与现有 `NOT_MEMBER` / `MUTED` 一致：
   - @到非会话成员 → `ERROR(reason=MENTION_NOT_MEMBER)`
   - 非群主/管理员 @所有人（且 `mention-all-admin-only=true`）→ `ERROR(reason=MENTION_ALL_FORBIDDEN)`
2. **单聊（SINGLE 会话）忽略 mentions/mentionAll**：不校验、不打标、正常落库扇出。@提及仅群聊语义。
3. **入口复用现有 Kafka `im-inbound` 消费链路**，不新增 REST。

## 现状（已就位，本期只补逻辑）

- `im_conversation_member.mention_seq BIGINT NOT NULL DEFAULT 0`（V3 迁移）——已建，无代码消费。
- `application.yml` `rbac.im.mention-all-admin-only: true`——已声明，无代码消费。
- `GroupService.isGroupManager(groupId, userId)`（里程碑8）——判 OWNER/ADMIN，成员不存在→false。
- `ConversationService.isMember(cid,userId)` / `memberUserIds(cid)` / `groupIdFromCid(cid)`——已有。
- 消息正文里的 `mentions`/`mentionAll` **原样落库、原样扇出**（`MessageAppender` 不改 body，`MessageQueryService.toVo` 直传），客户端据此高亮。本期不动消息正文。

## 上行 body 约定

`TEXT` 消息 `body` 可携带：
- `mentions`: `[userId...]`（@某些成员，元素为 Number/Long）
- `mentionAll`: `true`（@所有人）

二者可同时缺省（普通消息）。

## 组件

### 组件 1：`MentionService`（新建，`com.rbac.im.service`）

两段式拆分，避免重复解析 body。构造注入 `ConversationService`、`GroupService`、`ImConversationMemberMapper`，以及 `@Value("${rbac.im.mention-all-admin-only:true}") boolean mentionAllAdminOnly`（沿用 `RecallService` 构造注入 @Value 风格，便于纯单测）。

- **`List<Long> resolve(String cid, long senderId, String type, Map<String,Object> body)`**
  校验并返回「被命中且需打标」的成员 id（已展开 mentionAll、已排除发送者本人；去重）。非法即抛 `MentionValidationException(reason)`：
  - `type != "TEXT"` 或 `body == null` → 返回 `List.of()`（无 mention 语义）
  - **非群会话**（`cid` 不以 `g_` 开头）→ 返回 `List.of()`（单聊忽略，决策②）——即便携带 mentions 也不校验不打标
  - `mentionAll == true`：`mentionAllAdminOnly==true` 时要求 `groupService.isGroupManager(groupId, senderId)`，否则抛 `MENTION_ALL_FORBIDDEN`；命中集 = `memberUserIds(cid)` − senderId
  - 否则读 `mentions`：逐个必须 `isMember(cid, id)`，任一非成员抛 `MENTION_NOT_MEMBER`；命中集 = 这些 id − senderId（去重）
  - mentions 与 mentionAll 同时出现时，mentionAll 优先（命中集取全体，语义等价 @所有人）
- **`void apply(String cid, long seq, List<Long> targets)`**
  `targets` 为空则直接返回；否则调 `mapper.advanceMentionSeq(cid, targets, seq)`。

`MentionValidationException extends RuntimeException`，带 `String reason`（沿用 `MediaValidationException` 风格）。

### 组件 2：`ImConversationMemberMapper.advanceMentionSeq`（新增方法）

```java
@Update("<script>" +
  "UPDATE im_conversation_member SET mention_seq = #{seq} " +
  "WHERE cid = #{cid} AND mention_seq &lt; #{seq} AND user_id IN " +
  "<foreach item='u' collection='userIds' open='(' separator=',' close=')'>#{u}</foreach>" +
  "</script>")
int advanceMentionSeq(@Param("cid") String cid,
                      @Param("userIds") List<Long> userIds,
                      @Param("seq") long seq);
```

前向单调（`mention_seq < seq` 才更新，天然幂等，key=cid 分区内有序保证 seq 递增）+ IN 批量。调用方保证 `userIds` 非空。

### 组件 3：`InboundMessageConsumer` 接线

- append **前**（位置：`MUTED` 校验之后、媒体校验旁）：
  ```java
  List<Long> mentionTargets;
  try {
      mentionTargets = mentionService.resolve(env.getCid(), env.getSenderId(), env.getType(), env.getBody());
  } catch (MentionValidationException ex) {
      pushError(env, ex.getReason());
      return;
  }
  ```
- append **后**（拿到 seq）：`mentionService.apply(env.getCid(), seq, mentionTargets);`

构造函数追加 `MentionService` 依赖。

### 组件 4：「有人@我」标记 → `ImConversationVO`

新增字段 `Long mentionSeq` + `boolean hasMention`（= `mentionSeq > lastReadSeq`）。`ConversationService.listMyConversations` 已加载 `ImConversationMember` 列表，顺带把 `mentionSeq` 填进 per-cid 映射并计算 `hasMention`。

读后自动消除依赖 `lastReadSeq` 推进——里程碑10（已读未读）落地，本期基建先备好，无阻塞依赖（当前 `lastReadSeq` 恒为默认 0，`hasMention` 判定仍正确）。

## 数据流（群聊 @所有人，管理员发）

```
客户端 WS TEXT{text, mentionAll:true} → 网关校验成员 → Kafka im-inbound(key=cid)
  → InboundMessageConsumer:
       幂等/成员/禁言校验
       resolve() → 管理员通过 → targets = 全体 − sender
       append() → seq=N，body 原样（含 mentionAll）落库 + 扇出 PUSH
       apply(cid, N, targets) → 各命中成员 mention_seq=N
客户端拉会话列表 GET /api/im/conversations
  → listMyConversations → mentionSeq=N > lastReadSeq=0 → hasMention=true（强提醒红点）
```

## 错误码

| reason | 触发 |
|--------|------|
| `MENTION_NOT_MEMBER` | @到非会话成员 |
| `MENTION_ALL_FORBIDDEN` | 非群主/管理员 @所有人（mention-all-admin-only=true 时） |

## 测试计划（本会话内逐任务 TDD）

1. **Task 1**：`ImConversationMemberMapper.advanceMentionSeq` — 真容器 MySQL 测试：批量更新、前向单调（旧 seq 不回退）、IN 只命中目标、非成员不误伤。
2. **Task 2**：`MentionService.resolve` — 纯单测（mock ConversationService/GroupService）：
   - 群 mentionAll 管理员 → targets = 全体 − sender
   - 群 mentionAll 普通成员（admin-only=true）→ 抛 MENTION_ALL_FORBIDDEN
   - 群 mentionAll 普通成员（admin-only=false）→ 通过
   - 群 mentions 全部成员 → targets = 去 sender 去重
   - 群 mentions 含非成员 → 抛 MENTION_NOT_MEMBER
   - 单聊携带 mentions → List.of()（忽略）
   - 非 TEXT / null body → List.of()
   - mentionAll 与 mentions 同现 → 取全体
   - 仅 @自己 → List.of()（空 targets）
3. **Task 3**：`MentionService.apply` — 空 targets 跳过（never 调 mapper）；非空转发 mapper（mock 验证参数）。
4. **Task 4**：`InboundMessageConsumer` 接线 — mock：resolve 抛异常 → pushError(reason) 且不 append；正常路径 append 后调 apply(seq, targets)；既有消费者测试无回归。
5. **Task 5**：`ImConversationVO` + `listMyConversations` — 真容器：mentionSeq 填充、hasMention 计算（mentionSeq>lastReadSeq）。
6. **Task 6**：端到端 `MentionE2ETest` — 建群→管理员 @所有人→各成员 mention_seq=seq + 会话列表 hasMention=true；普通成员 @所有人被拒（ERROR）；@非成员被拒（ERROR）。
7. **Task 7**：全量回归（`-Dtest='com.rbac.im.**'` + `mvn package`），设计文档里程碑9 标注完成，更新进度台账。

## 非目标 / follow-up

- 已读推进（`lastReadSeq` 更新与已读回执）属里程碑10，本期不做。
- 客户端渲染高亮属前端，本期仅保证 body 透传。
- mention_seq 不做「取消@」回退（撤回含 mention 的消息不回退 mention_seq；与整体 seq 单调语义一致，MVP 姿态）。
