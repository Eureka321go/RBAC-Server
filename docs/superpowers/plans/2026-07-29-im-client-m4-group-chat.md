# IM 客户端 M4 · 完整群聊管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 React Native 客户端一次接入建群、群文本聊天、系统消息和完整群成员/角色管理。

**Architecture:** `im-sdk-core` 新增平台无关的 `GroupService`；SQLite 会话快照持久化统一 `displayName`；React Native 新增建群与群详情页面并复用现有聊天链路。服务端始终是权限与成员状态的最终事实源。

**Tech Stack:** TypeScript、React Native 0.86、React Navigation 7、Zustand、op-sqlite、Axios 适配器。

## Global Constraints

- `im-sdk-core` 不得 import React、React Native、Axios、op-sqlite 或 Node 内置模块。
- API 字段保持 camelCase；群角色固定为 `OWNER` / `ADMIN` / `MEMBER`。
- SQLite 仍是会话与消息 UI 的唯一事实源；旧响应不得回退消息、阅读或同步位点。
- 客户端权限只控制交互可见性，后端 403 是最终权限结果。
- 不修改现有账号切换清库、deviceId、多端连接和单聊 READ 回执语义。
- 本轮不新增或运行自动化测试；只做 TypeScript 类型检查、平台依赖检查与 `git diff --check`。
- 不接入图片、语音、文件、链接卡片、撤回和 `@` 提及。

---

### Task 1: SDK 群领域服务

**Files:**
- Create: `im-client/packages/im-sdk-core/src/group/groupService.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`
- Modify: `im-client/packages/im-sdk-rn/src/createSdk.ts`

**Interfaces:**
- Consumes: `Http.get/post/patch/put/delete` 与后端 `Result<T>` 响应。
- Produces: `GroupService`、`GroupRole`、`GroupDetail`、`GroupMember`、`CreateGroupResult`，以及 `sdk.groups`。

- [x] **Step 1: 定义群领域类型与统一响应解包**

```ts
export type GroupRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export interface GroupDetail {
  groupId: number;
  name: string;
  ownerId: number;
  memberCount: number;
  myRole: GroupRole;
}
export interface GroupMember {
  userId: number;
  role: GroupRole;
  muted: boolean;
}
```

统一检查 `res.code === 200`；否则抛出 `Error(res.message || fallback)`。

- [x] **Step 2: 实现全部群 REST 方法**

严格映射 `/im/groups` 的建群、详情、成员、加人、踢人、改名、角色、禁言、转让、退群和解散接口；对群名 `trim()`，成员 ID 去重。

- [x] **Step 3: 导出并装配服务**

`createSdk` 中创建 `const groups = new GroupService(http)`，返回值增加 `groups`。

- [x] **Step 4: 静态检查并提交**

```bash
npx tsc -p packages/im-sdk-core --noEmit
git add im-client/packages/im-sdk-core/src/group/groupService.ts im-client/packages/im-sdk-core/src/index.ts im-client/packages/im-sdk-rn/src/createSdk.ts
git commit -m "feat(im-client): add group management service"
```

### Task 2: 本地群名与会话定向清理

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/store/migrations.ts`
- Modify: `im-client/packages/im-sdk-core/src/store/messageStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/sync/syncService.ts`
- Modify: `im-client/packages/im-sdk-rn/src/createSdk.ts`

**Interfaces:**
- Consumes: Task 1 的 `GroupService.getGroup(groupId)`。
- Produces: `ConversationRow.displayName`、`MessageStore.setConversationDisplayName(cid, name)`、`MessageStore.removeConversation(cid)`、`SyncService.removeLocalConversation(cid)`。

- [x] **Step 1: 新增兼容迁移**

在 `conversations` 增加 nullable `display_name TEXT`，使用迁移版本表/列探测兼容已安装数据库，不重复执行破坏性建表。

- [x] **Step 2: 扩展快照读写**

`ConversationRow` 增加 `displayName: string | null`。快照 upsert 对非空新名称更新；空名称保留旧值。列表查询返回该字段。

- [x] **Step 3: 实现定向名称更新与幂等清理**

```ts
setConversationDisplayName(cid: string, name: string): Promise<void>
removeConversation(cid: string): Promise<void>
```

`removeConversation` 在单个事务内删除该 `cid` 的 outbox、messages、conversations 和 sync_meta。

- [x] **Step 4: 同步群详情名称**

给 `SyncService` 注入 `GroupService`。写入会话快照后逐个补群详情；失败时保留旧名称并继续同步其他会话。建群和改名页面可调用公开名称更新方法。

- [x] **Step 5: 静态检查并提交**

```bash
npx tsc -p packages/im-sdk-core --noEmit
git add im-client/packages/im-sdk-core/src/store/migrations.ts im-client/packages/im-sdk-core/src/store/messageStore.ts im-client/packages/im-sdk-core/src/sync/syncService.ts im-client/packages/im-sdk-rn/src/createSdk.ts
git commit -m "feat(im-client): persist group conversation names"
```

### Task 3: 可复用联系人选择与创建群聊

**Files:**
- Create: `im-client/packages/app-mobile/src/services/users.ts`
- Create: `im-client/packages/app-mobile/src/screens/CreateGroupScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ContactsScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/navigation/types.ts`
- Modify: `im-client/packages/app-mobile/App.tsx`

**Interfaces:**
- Consumes: `sdk.http` 用户列表接口、`sdk.groups.createGroup`、`sdk.sync.syncConversation`。
- Produces: `listSelectableUsers(myId)`、`CreateGroup` 导航路由和群聊导航参数。

- [x] **Step 1: 抽取用户列表数据源**

```ts
export interface SelectableUser { id: number; username: string; nickname: string | null }
export async function listSelectableUsers(myId: number | null): Promise<SelectableUser[]>
```

复用现有 `/system/users` 请求、结果过滤与显示名逻辑；单聊页面行为保持不变。

- [x] **Step 2: 增加导航类型与页面注册**

`RootStackParamList` 增加 `CreateGroup` 和 `GroupDetails`；`Chat` 参数增加 `conversationType` 与可选 `groupId`。

- [x] **Step 3: 实现建群多选页**

群名 trim 后非空、至少选择一人时允许提交。提交成功后保存群名、同步 cid，并 `replace('Chat', ...)`。请求中禁用所有选择和提交操作。

- [x] **Step 4: 会话列表接入入口和真实群名**

新建区域提供“发起单聊/创建群聊”；标题优先 `row.displayName`，群名缺失才回退 `群聊 #id`。

- [x] **Step 5: 类型检查并提交**

```bash
npx tsc -p packages/app-mobile --noEmit
git add im-client/packages/app-mobile/src/services/users.ts im-client/packages/app-mobile/src/screens/CreateGroupScreen.tsx im-client/packages/app-mobile/src/screens/ContactsScreen.tsx im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx im-client/packages/app-mobile/src/navigation/types.ts im-client/packages/app-mobile/App.tsx
git commit -m "feat(im-client): add group creation flow"
```

### Task 4: 群聊天展示与系统消息

**Files:**
- Create: `im-client/packages/app-mobile/src/group/systemMessage.ts`
- Modify: `im-client/packages/app-mobile/src/components/CompactScreenHeader.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: `ChatMessage.type/body`、`Chat` 路由的 `conversationType/groupId`。
- Produces: `formatGroupSystemMessage(message): string` 和群详情入口。

- [x] **Step 1: 实现 SYSTEM 事件格式化**

覆盖 `GROUP_CREATE`、`MEMBER_JOIN`、`MEMBER_LEAVE`、`MEMBER_KICK`、`GROUP_DISSOLVE`、`GROUP_RENAME`、`OWNER_TRANSFER`、`ADMIN_CHANGE`、`MEMBER_MUTE`；未知事件返回“群聊信息已更新”。

- [x] **Step 2: 扩展紧凑标题栏**

增加可选 `rightLabel/onRightPress`，保持没有右侧动作时原布局不变。

- [x] **Step 3: 群消息分支渲染**

SYSTEM 消息使用居中灰色提示；群聊隐藏单聊 `peerReadSeq` 状态；标题栏右侧进入 `GroupDetails`。普通文本发送、重试和已读上报保持原逻辑。

- [x] **Step 4: 类型检查并提交**

```bash
npx tsc -p packages/app-mobile --noEmit
git add im-client/packages/app-mobile/src/group/systemMessage.ts im-client/packages/app-mobile/src/components/CompactScreenHeader.tsx im-client/packages/app-mobile/src/screens/ChatScreen.tsx
git commit -m "feat(im-client): render group chat system messages"
```

### Task 5: 完整群详情与管理

**Files:**
- Create: `im-client/packages/app-mobile/src/screens/GroupDetailsScreen.tsx`
- Create: `im-client/packages/app-mobile/src/components/UserMultiSelect.tsx`
- Modify: `im-client/packages/app-mobile/App.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: Task 1 全部 `sdk.groups` 方法、Task 2 本地名称/清理、Task 3 联系人数据源。
- Produces: 完整群资料、成员管理和退出/解散流程。

- [x] **Step 1: 实现群详情加载与角色能力计算**

并行加载 `getGroup` 和 `getMembers`；网络错误保留旧数据。用纯函数计算 OWNER/ADMIN/MEMBER 可执行操作，页面刷新后以最新角色为准。

- [x] **Step 2: 实现改名和添加成员**

改名成功写本地 `displayName` 并刷新；添加成员弹出复用多选组件，排除现有成员，成功后重载成员列表。

- [x] **Step 3: 实现成员级操作**

每行按权限提供踢人、设/免管理员、禁言/解禁和转让群主。用 `pendingMemberId` 独立锁定目标；转让群主必须二次确认。

- [x] **Step 4: 实现退群和解散**

二次确认后调用后端，执行 `removeLocalConversation(cid)`，回到会话列表并后台 `syncAll()`。OWNER 显示解散，非 OWNER 显示退出。

- [x] **Step 5: 响应 SYSTEM 更新**

详情页监听当前 cid 的 `message` 事件；SYSTEM 到达后重新加载详情和成员，失败时显示提示但保留旧内容。

- [x] **Step 6: 类型检查并提交**

```bash
npx tsc -p packages/app-mobile --noEmit
git add im-client/packages/app-mobile/src/screens/GroupDetailsScreen.tsx im-client/packages/app-mobile/src/components/UserMultiSelect.tsx im-client/packages/app-mobile/App.tsx im-client/packages/app-mobile/src/screens/ChatScreen.tsx
git commit -m "feat(im-client): add full group administration"
```

### Task 6: 集成校验与交付

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-m4-group-chat.md`

**Interfaces:**
- Consumes: Tasks 1–5 的完整实现。
- Produces: 通过静态检查的工作区、已更新复选框和双模拟器手测清单。

- [x] **Step 1: 运行允许的静态检查**

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
rg -n "from ['\"](react|react-native|axios|@op-engineering/op-sqlite|node:)" packages/im-sdk-core/src
git diff --check
```

core 平台依赖搜索预期无匹配；两个 TypeScript 命令和 diff 检查退出码为 0。

- [x] **Step 2: 检查完整 diff 与现有脏文件隔离**

确认不覆盖 `backend/src/main/java/com/rbac/im/service/ConversationService.java` 和 `im-client/packages/app-mobile/package.json` 的已有用户改动，也不把它们加入 M4 提交。

- [x] **Step 3: 更新计划状态并提交文档**

将已完成步骤勾选，记录未执行自动化测试是用户明确约束，然后只提交本计划文档。

- [x] **Step 4: 输出手工验收清单**

按设计文档第八节覆盖建群、角色权限、成员管理、群消息、离线、错误状态、退群/解散和单聊回归。

## 执行记录

- 完成日期：2026-07-29。
- `im-sdk-core` 与 `app-mobile` TypeScript 类型检查通过。
- core 平台依赖检查无匹配，M4 提交范围 `git diff --check` 通过。
- 按用户明确约束，未新增或运行自动化测试；功能验收由用户按交付清单在双模拟器执行。
