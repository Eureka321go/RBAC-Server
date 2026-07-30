# IM 客户端消息免打扰实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为单聊和群聊提供服务端持久化、客户端可同步并可从会话列表长按切换的消息免打扰设置。

**Architecture:** `im_conversation_member.muted` 作为当前账号在目标会话中的服务端权威状态，设置接口只允许当前登录用户更新自己的成员行。会话快照将状态同步到 SDK SQLite，移动端只从 SQLite 渲染并通过受控操作面板发起更新。

**Tech Stack:** Java 17、Spring Boot、MyBatis-Plus、TypeScript、SQLite、React Native、React Navigation。

## Global Constraints

- 单聊和群聊使用同一状态、接口和交互。
- 免打扰不改变消息接收、存储、排序、未读数、已读水位、@ 提醒或消息发送。
- 当前没有系统通知链路，本轮不新增系统通知能力。
- 服务端从登录上下文确定操作者，并验证 `cid + userId` 成员关系。
- 设置接口成功后才更新本地状态；失败保留原状态并显示中文错误。
- 不新增或运行 Jest、Vitest、JUnit 或 E2E；仅执行编译、类型检查、相关 ESLint 和差异检查。
- 保留且不提交用户在 `ImConversationMember.java` 与 `ConversationService.java` 中已有的注释改动；涉及 `ConversationService.java` 时仅暂存本功能补丁。
- 所有提交只保留在本地，不主动 push。

---

## 文件结构

- 新建 `backend/src/main/java/com/rbac/im/dto/SetConversationMuteRequest.java`：校验免打扰请求。
- 修改 `backend/src/main/java/com/rbac/im/controller/ImConversationController.java`：暴露当前用户设置接口。
- 修改 `backend/src/main/java/com/rbac/im/service/ConversationService.java`：验证成员关系、更新状态并生成快照字段。
- 修改 `backend/src/main/java/com/rbac/im/vo/ImConversationVO.java`：输出布尔 `muted`。
- 修改 `im-client/packages/im-sdk-core/src/store/migrations.ts`：增加 SQLite 字段。
- 修改 `im-client/packages/im-sdk-core/src/store/messageStore.ts`：读写本地免打扰状态。
- 修改 `im-client/packages/im-sdk-core/src/sync/syncService.ts`：同步快照并封装设置调用。
- 新建 `im-client/packages/app-mobile/src/components/ConversationActionSheet.tsx`：承载会话级动作。
- 修改 `im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx`：长按、设置、错误反馈与静音图标。
- 修改 `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`：记录验收和开发状态。

### Task 1: 服务端权威状态与设置接口

**Files:**
- Create: `backend/src/main/java/com/rbac/im/dto/SetConversationMuteRequest.java`
- Modify: `backend/src/main/java/com/rbac/im/controller/ImConversationController.java`
- Modify: `backend/src/main/java/com/rbac/im/service/ConversationService.java`
- Modify: `backend/src/main/java/com/rbac/im/vo/ImConversationVO.java`

**Interfaces:**
- Consumes: 当前登录用户 ID、路径参数 `cid`、请求字段 `Boolean muted`。
- Produces: `PUT /im/conversations/{cid}/mute` 与会话快照字段 `boolean muted`。

- [ ] **Step 1: 定义请求 DTO**

创建不可缺省的布尔请求字段：

```java
@Data
public class SetConversationMuteRequest {
    @NotNull
    private Boolean muted;
}
```

- [ ] **Step 2: 实现成员级更新方法**

在 `ConversationService` 增加：

```java
@Transactional
public void setMuted(long userId, String cid, boolean muted) {
    ImConversationMember member = memberMapper.selectOne(
            new LambdaQueryWrapper<ImConversationMember>()
                    .eq(ImConversationMember::getCid, cid)
                    .eq(ImConversationMember::getUserId, userId));
    if (member == null) {
        throw new BusinessException(403, "im.conversation.notMember");
    }
    member.setMuted(muted ? 1 : 0);
    memberMapper.updateById(member);
}
```

快照组装前从当前用户成员行构建 `mutedByCid`，空值按 `false`，并执行 `vo.setMuted(...)`。不要修改或删除用户已有的解释性注释。

- [ ] **Step 3: 暴露认证接口和快照字段**

在控制器增加：

```java
@PutMapping("/conversations/{cid}/mute")
public Result<Void> setMuted(
        @PathVariable String cid,
        @Valid @RequestBody SetConversationMuteRequest request) {
    conversationService.setMuted(SecurityUtils.getUserId(), cid, request.getMuted());
    return Result.success();
}
```

在 `ImConversationVO` 增加 `private boolean muted;`。

- [ ] **Step 4: 静态验证服务端**

Run: `mvn -f backend/pom.xml -Dmaven.test.skip=true package`

Expected: `BUILD SUCCESS`；测试被跳过。

- [ ] **Step 5: 审查并提交服务端功能补丁**

先执行：

```bash
git diff -- backend/src/main/java/com/rbac/im/dto/SetConversationMuteRequest.java \
  backend/src/main/java/com/rbac/im/controller/ImConversationController.java \
  backend/src/main/java/com/rbac/im/service/ConversationService.java \
  backend/src/main/java/com/rbac/im/vo/ImConversationVO.java
```

对 `ConversationService.java` 使用仅包含功能行的索引补丁暂存，确认 `git diff --cached` 不包含用户注释，再提交：

```bash
git commit -m "功能(IM后端)：持久化会话免打扰设置"
```

### Task 2: SDK 会话状态同步

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/store/migrations.ts`
- Modify: `im-client/packages/im-sdk-core/src/store/messageStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/sync/syncService.ts`

**Interfaces:**
- Consumes: 服务端快照 `muted: boolean` 与 `PUT /im/conversations/{cid}/mute`。
- Produces: `ConversationRow.muted: boolean`、`MessageStore.setConversationMuted(cid, muted)`、`SyncService.setConversationMuted(cid, muted)`。

- [ ] **Step 1: 增加 SQLite 迁移和行类型**

在迁移数组末尾追加：

```sql
ALTER TABLE conversations ADD COLUMN muted INTEGER NOT NULL DEFAULT 0
```

为 `ConversationRow` 增加 `muted: boolean`。

- [ ] **Step 2: 前向同步并读取状态**

`upsertConversationSnapshot` 的插入列、参数和冲突更新都包含 `muted`，冲突时直接执行：

```sql
muted = excluded.muted
```

`getConversationRows` 查询该列并映射为：

```ts
muted: r.muted === 1,
```

- [ ] **Step 3: 实现本地写入与 SDK 设置方法**

`MessageStore` 增加：

```ts
async setConversationMuted(cid: string, muted: boolean): Promise<void> {
  await this.db.exec(
    `UPDATE conversations SET muted = ? WHERE cid = ?`,
    [muted ? 1 : 0, cid],
  );
}
```

`ConversationSnapshot` 增加 `muted: boolean`。`SyncService.setConversationMuted` 先 PUT，校验 `code === 200`，再写 SQLite 并发出 `conversation` 事件；请求体为 `{ muted }`。

- [ ] **Step 4: 静态验证 SDK**

Run: `cd im-client && npx tsc -p packages/im-sdk-core --noEmit`

Expected: exit code `0`。

- [ ] **Step 5: 审查并提交 SDK 功能**

```bash
git diff -- im-client/packages/im-sdk-core/src/store/migrations.ts \
  im-client/packages/im-sdk-core/src/store/messageStore.ts \
  im-client/packages/im-sdk-core/src/sync/syncService.ts
git commit -m "功能(IM客户端)：同步会话免打扰状态"
```

### Task 3: 会话列表长按交互

**Files:**
- Create: `im-client/packages/app-mobile/src/components/ConversationActionSheet.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx`

**Interfaces:**
- Consumes: `ConversationRow.muted` 与 `sdk.sync.setConversationMuted(cid, muted)`。
- Produces: 会话长按菜单、切换动作、静音图标和中文失败提示。

- [ ] **Step 1: 创建受控会话操作面板**

组件属性固定为：

```ts
interface Props {
  visible: boolean;
  muted: boolean;
  busy: boolean;
  onClose: () => void;
  onToggleMuted: () => void;
}
```

面板标题为“会话操作”，动作文本根据状态显示“消息免打扰”或“取消免打扰”；`busy` 时禁用关闭和重复提交，并显示“正在设置…”。

- [ ] **Step 2: 接入长按并抑制误点击**

`ConversationsScreen` 增加 `selectedConversation`、`mutating` 和每行长按标记。行 `onLongPress` 打开菜单，普通 `onPress` 在检测到刚发生长按时直接返回，否则进入聊天。设置 `delayLongPress={350}`。

- [ ] **Step 3: 调用 SDK 并呈现状态**

执行动作时调用：

```ts
await sdk.sync.setConversationMuted(selected.cid, !selected.muted);
```

成功关闭菜单并重读 SQLite；失败保留菜单状态并设置中文错误 `设置消息免打扰失败：…`。在标题行展示 `volume-mute-outline` 图标，无障碍描述包含“已开启消息免打扰”。

- [ ] **Step 4: 静态验证移动端和 Lint 基线**

Run:

```bash
cd im-client
npx tsc -p packages/app-mobile --noEmit
npx eslint packages/app-mobile/src/components/ConversationActionSheet.tsx \
  packages/app-mobile/src/screens/ConversationsScreen.tsx
```

Expected: TypeScript exit code `0`；新增组件无 ESLint 错误。若页面存在既有告警，使用功能前提交作输入对比，错误和警告数量不得增加。

- [ ] **Step 5: 审查并提交移动端交互**

```bash
git diff -- im-client/packages/app-mobile/src/components/ConversationActionSheet.tsx \
  im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx
git commit -m "功能(IM客户端)：支持会话消息免打扰"
```

### Task 4: 交接记录与最终静态验证

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`

**Interfaces:**
- Consumes: 前三项本地提交和静态验证结果。
- Produces: 下一窗口可直接继续置顶聊天设计的准确交接状态。

- [ ] **Step 1: 更新交接状态**

记录消息引用与富媒体长按已由用户手动验收通过，消息免打扰代码待手动验收；补充设计、计划、关键提交、静态检查结果和手测清单。

- [ ] **Step 2: 执行最终静态验证**

Run:

```bash
mvn -f backend/pom.xml -Dmaven.test.skip=true package
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
git diff --check
git status --short
```

Expected: 编译与类型检查退出码 `0`；测试被跳过；差异检查无空白错误；状态只剩用户已有的两个后端注释改动和待提交交接文档。

- [ ] **Step 3: 提交交接文档**

```bash
git commit -m "文档(IM客户端)：记录消息免打扰开发状态"
```

- [ ] **Step 4: 提供手测清单**

只向用户列出设计文档中的六项手测场景，不运行自动化测试，不 push。手测通过后再进入“置顶聊天”设计。
