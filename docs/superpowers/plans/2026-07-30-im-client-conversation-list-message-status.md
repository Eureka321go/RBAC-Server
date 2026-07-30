# IM 会话列表与消息状态实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用真实最新消息时间驱动会话列表排序与展示，并将未读、免打扰和己方消息状态调整为清晰、互斥的微信式层级。

**Architecture:** 服务端在会话摘要中显式持久化 `lastMsgTs`，SDK SQLite 从快照和消息事件前向合并该字段。移动端会话行拆分头像、中间内容和右侧状态区；聊天页通过独立状态组件保证发送中、上传中、失败和撤回中最多展示一种状态。

**Tech Stack:** Java 21、Spring Boot、MyBatis-Plus、Flyway、TypeScript、SQLite、React Native。

## Global Constraints

- 不用同步时间或普通审计时间冒充最新消息时间。
- 时间统一使用 epoch milliseconds，UI 按设备本地时区格式化。
- 乱序消息和旧快照不得回退最新消息序号、摘要或时间。
- 未读数字保留并移动到头像右上角；免打扰图标位于右侧下方。
- 同一条己方消息最多显示一个状态控件，失败与取消按钮触摸区域至少 44×44。
- 不改变消息发送协议、未读计算、已读回执、重试流程或免打扰语义。
- 不新增或运行 Jest、Vitest、JUnit 或 E2E；只执行跳过测试的后端编译、TypeScript、相关 ESLint 和差异检查。
- 保留且不提交用户在 `ImConversationMember.java` 与 `ConversationService.java` 中已有的注释改动；涉及 `ConversationService.java` 时仅暂存本功能行。
- 所有提交只保留在本地，不主动 push。

---

## 文件结构

- 新建 `backend/src/main/resources/db/migration/V6__im_conversation_last_msg_ts.sql`：增加并回填服务端时间字段。
- 修改 `backend/src/main/java/com/rbac/im/entity/ImConversation.java`：映射 `lastMsgTs`。
- 修改 `backend/src/main/java/com/rbac/im/service/MessageAppender.java`：用消息时间更新会话摘要。
- 修改 `backend/src/main/java/com/rbac/im/service/ConversationService.java`：初始化并下发最新消息时间。
- 修改 `backend/src/main/java/com/rbac/im/vo/ImConversationVO.java`：输出 `lastMsgTs`。
- 修改 `im-client/packages/im-sdk-core/src/store/migrations.ts`：增加并从本地消息回填 SQLite 字段。
- 修改 `im-client/packages/im-sdk-core/src/store/messageStore.ts`：合并、读取并排序最新消息时间。
- 修改 `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`：把消息 `ts` 传入会话摘要。
- 修改 `im-client/packages/im-sdk-core/src/sync/syncService.ts`：接收服务端快照字段。
- 新建 `im-client/packages/app-mobile/src/conversation/conversationTime.ts`：格式化微信式列表时间。
- 修改 `im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx`：重组头像徽标、内容和右侧元信息。
- 新建 `im-client/packages/app-mobile/src/components/OutgoingMessageState.tsx`：统一己方消息状态槽位。
- 修改 `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`：修正撤回判定并调整状态控件顺序。
- 修改 `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`：记录实现与手测边界。

### Task 1: 服务端最新消息时间

**Files:**
- Create: `backend/src/main/resources/db/migration/V6__im_conversation_last_msg_ts.sql`
- Modify: `backend/src/main/java/com/rbac/im/entity/ImConversation.java`
- Modify: `backend/src/main/java/com/rbac/im/service/MessageAppender.java`
- Modify: `backend/src/main/java/com/rbac/im/service/ConversationService.java`
- Modify: `backend/src/main/java/com/rbac/im/vo/ImConversationVO.java`

**Interfaces:**
- Consumes: `MessageAppender.append` 已生成的 `long ts`。
- Produces: 数据库字段 `last_msg_ts` 与快照字段 `Long lastMsgTs`。

- [ ] **Step 1: 新增并回填 MySQL 字段**

迁移内容：

```sql
ALTER TABLE `im_conversation`
    ADD COLUMN `last_msg_ts` BIGINT NOT NULL DEFAULT 0 AFTER `last_msg_preview`;

UPDATE `im_conversation`
SET `last_msg_ts` = UNIX_TIMESTAMP(`updated_at`) * 1000
WHERE `last_msg_seq` > 0 AND `updated_at` IS NOT NULL AND `last_msg_ts` = 0;
```

- [ ] **Step 2: 映射并写入时间**

`ImConversation` 增加 `private Long lastMsgTs;`。新建单聊和群聊时显式设置 `0L`。`MessageAppender.updateSummary` 接收 `ts` 并执行：

```java
c.setLastMsgSeq(seq);
c.setLastMsgPreview(preview);
c.setLastMsgTs(ts);
```

- [ ] **Step 3: 下发快照字段**

`ImConversationVO` 增加 `private Long lastMsgTs;`，组装时空值按 `0L`：

```java
vo.setLastMsgTs(c.getLastMsgTs() == null ? 0L : c.getLastMsgTs());
```

- [ ] **Step 4: 编译与差异审查**

Run: `mvn -f backend/pom.xml -Dmaven.test.skip=true package`

Expected: `BUILD SUCCESS`，测试被跳过。审查 `ConversationService.java` 的暂存补丁，确保不含用户已有注释。

- [ ] **Step 5: 提交服务端改动**

```bash
git commit -m "修复(IM后端)：记录会话最新消息时间"
```

### Task 2: SDK 时间迁移与前向合并

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/store/migrations.ts`
- Modify: `im-client/packages/im-sdk-core/src/store/messageStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`
- Modify: `im-client/packages/im-sdk-core/src/sync/syncService.ts`

**Interfaces:**
- Consumes: 快照 `lastMsgTs: number` 与消息 `ts: number`。
- Produces: `ConversationRow.lastMsgTs: number` 和按最新消息时间排序的会话列表。

- [ ] **Step 1: 增加 SQLite 迁移**

在迁移数组末尾依次追加：

```sql
ALTER TABLE conversations ADD COLUMN last_msg_ts INTEGER NOT NULL DEFAULT 0
```

```sql
UPDATE conversations
SET last_msg_ts = COALESCE(
  (SELECT MAX(messages.ts) FROM messages WHERE messages.cid = conversations.cid),
  0
)
WHERE last_msg_ts = 0
```

- [ ] **Step 2: 扩展会话类型和快照 SQL**

`ConversationRow` 与 `ConversationSnapshot` 增加 `lastMsgTs: number`。`upsertConversationSnapshot` 插入该字段，冲突时使用：

```sql
last_msg_ts = MAX(conversations.last_msg_ts, excluded.last_msg_ts)
```

`getConversationRows` 读取并映射 `last_msg_ts`，查询排序改为：

```sql
ORDER BY last_msg_ts DESC, updated_at DESC
```

- [ ] **Step 3: 使用消息时间推进摘要**

`advanceConversation` 参数新增 `ts: number`。更新 SQL 只在消息 `seq` 不旧于当前摘要时前向合并时间：

```sql
last_msg_ts = CASE WHEN excluded.last_msg_seq >= conversations.last_msg_seq
                   THEN MAX(conversations.last_msg_ts, excluded.last_msg_ts)
                   ELSE conversations.last_msg_ts END
```

`SyncEngine` 调用时传入 `ts: message.ts`。

- [ ] **Step 4: SDK 静态验证与提交**

Run: `cd im-client && npx tsc -p packages/im-sdk-core --noEmit`

Expected: exit code `0`。

```bash
git commit -m "修复(IM客户端)：同步会话最新消息时间"
```

### Task 3: 微信式会话列表层级

**Files:**
- Create: `im-client/packages/app-mobile/src/conversation/conversationTime.ts`
- Modify: `im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx`

**Interfaces:**
- Consumes: `ConversationRow.lastMsgTs`、`unreadCount`、`muted`。
- Produces: `formatConversationTime(timestamp, now?)` 与三栏会话行布局。

- [ ] **Step 1: 实现本地时间格式化**

导出：

```ts
export function formatConversationTime(timestamp: number, now = new Date()): string
```

无效或非正数返回空字符串；同日返回 `HH:mm`，前一日返回“昨天”，相差 2 至 6 个本地自然日返回 `周日` 至 `周六`，同年更早返回 `M/D`，跨年返回 `YYYY/M/D`。

- [ ] **Step 2: 重组会话行**

头像包裹层使用 `position: 'relative'`，未读徽标绝对定位到右上角。删除行末旧徽标。中间区只渲染标题与摘要；右侧 `meta` 固定宽度约 56，顶部渲染时间，底部渲染免打扰图标。

时间调用改为：

```ts
const time = formatConversationTime(item.lastMsgTs);
```

无障碍标签补充 `${unreadCount} 条未读`。

- [ ] **Step 3: 移动端静态验证与提交**

Run:

```bash
cd im-client
npx tsc -p packages/app-mobile --noEmit
npx eslint packages/app-mobile/src/conversation/conversationTime.ts \
  packages/app-mobile/src/screens/ConversationsScreen.tsx
```

Expected: TypeScript exit code `0`；新文件 0 错误；页面错误和警告数量不超过修改前基线。

```bash
git commit -m "优化(IM客户端)：重排会话列表信息层级"
```

### Task 4: 互斥的己方消息状态槽位

**Files:**
- Create: `im-client/packages/app-mobile/src/components/OutgoingMessageState.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: `ChatMessage`、`recalling: boolean`、取消上传与重试回调。
- Produces: 每条己方消息最多一个位于气泡左侧的状态控件。

- [ ] **Step 1: 创建状态组件**

组件接口：

```ts
interface Props {
  message: ChatMessage;
  recalling: boolean;
  onCancelUpload: () => void;
  onRetry: () => void;
}
```

按 `failed`、`uploading`、`sending/acked/recalling` 的优先级渲染失败按钮、取消按钮或 `ActivityIndicator`，否则返回 `null`。两个按钮复用 `IconButton` 的 44×44 触摸区域。

- [ ] **Step 2: 修正撤回判定并调整顺序**

只为己方消息渲染状态组件，且撤回判断必须是：

```ts
const recalling = item.seq != null && recallingSeq === item.seq;
```

JSX 顺序改成状态组件、`messageContent`、己方头像。删除原来气泡后的三段独立状态判断。

- [ ] **Step 3: 移动端静态验证与提交**

Run:

```bash
cd im-client
npx tsc -p packages/app-mobile --noEmit
npx eslint packages/app-mobile/src/components/OutgoingMessageState.tsx \
  packages/app-mobile/src/screens/ChatScreen.tsx
```

Expected: TypeScript exit code `0`；新组件 0 错误；`ChatScreen.tsx` 与修改前保持相同的 4 个既有错误和 21 个既有警告。

```bash
git commit -m "修复(IM客户端)：统一己方消息状态位置"
```

### Task 5: 交接记录与最终验证

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`

**Interfaces:**
- Consumes: 前四项提交和验证结果。
- Produces: 准确的当前状态、根因、关键提交与手测清单。

- [ ] **Step 1: 更新交接文档**

记录错误同步时间、空 seq 撤回误判、最终数据流、微信式布局、提交和八项手测场景。

- [ ] **Step 2: 最终静态验证**

Run:

```bash
mvn -f backend/pom.xml -Dmaven.test.skip=true package
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
git diff --check
git status --short
```

Expected: 编译、类型检查与差异检查退出码 `0`；测试被跳过；状态只剩用户原有的两个后端注释改动和待提交交接文档。

- [ ] **Step 3: 提交文档并交付手测清单**

```bash
git commit -m "文档(IM客户端)：记录会话列表与消息状态修复"
```

不 push，不运行自动化测试；等待用户手动验收后再继续置顶聊天。
