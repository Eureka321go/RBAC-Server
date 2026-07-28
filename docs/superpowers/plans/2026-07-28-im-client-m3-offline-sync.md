# IM 客户端 M3 · 会话列表与离线增量同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 本轮按用户要求不编写或运行自动化测试，交付手工验收清单。

**Goal:** 增加会话列表，并在登录连接成功、App 回前台及进入会话时按本地 `synced_seq` 分页补齐离线消息。

**Architecture:** SQLite 继续作为 UI 的唯一事实源。新增纯 TypeScript `SyncService` 调用 REST，将会话快照写入 `conversations`，将拉取到的消息复用 `SyncEngine` 的事务落库路径；RN 页面只读本地库并订阅 SDK 事件刷新。

**Tech Stack:** TypeScript、React Native 0.86、op-sqlite、React Navigation、Zustand。

## Global Constraints

- `im-sdk-core` 禁止 import React、React Native、op-sqlite 或 Node 内置模块。
- API 字段保持 camelCase；会话类型使用 `SINGLE` / `GROUP`。
- 同步位点与会话最新序号只允许前向推进，旧 REST 响应不得覆盖更新的 WS PUSH。
- 同一时刻只允许一个全量同步；单会话同步按 cid 单飞，分页游标不前进时立即停止，避免死循环。
- 网络失败保留 SQLite 旧数据，并通过 `syncState` 事件告诉 UI，不清空会话列表。
- 本轮不写或运行自动化测试；仅运行 TypeScript 类型检查，功能测试由用户按交付清单执行。

---

## Task 1: 本地会话快照仓储

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/store/messageStore.ts`

**Produces:**
- `ConversationRow`
- `upsertConversationSnapshot(row): Promise<void>`
- `getConversationRows(): Promise<ConversationRow[]>`

- [ ] 扩展会话行类型，覆盖服务端会话列表全部位点字段。
- [ ] 用 `MAX` 与条件预览更新实现不回退 upsert。
- [ ] 提供按 `updated_at DESC` 的完整本地会话查询。
- [ ] 提交 `feat(im-client): 增加本地会话快照读写（M3 Task1）`。

## Task 2: SyncEngine REST 落库与 SyncService

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`
- Create: `im-client/packages/im-sdk-core/src/sync/syncService.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`

**Produces:**
- `SyncEngine.applyRestMessage(message): Promise<void>`
- `SyncService.syncAll(): Promise<void>`
- `SyncService.syncConversation(cid): Promise<void>`
- `SyncService.getConversations(): Promise<ConversationRow[]>`
- `SdkEvents.syncState`

- [ ] 抽取引擎内部统一落库方法，让 REST 消息保留 `recalled` 状态。
- [ ] 拉 `/im/conversations` 写快照，再对每个 cid 从本地位点分页拉 `/im/messages?sinceSeq=&limit=100`。
- [ ] 实现全量/单会话 single-flight、游标停滞保护、错误事件与会话刷新事件。
- [ ] 导出新模块。
- [ ] 提交 `feat(im-client): 增加离线分页同步服务（M3 Task2）`。

## Task 3: 生命周期装配

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/ports/index.ts`
- Modify: `im-client/packages/im-sdk-core/src/connection/connectionManager.ts`
- Modify: `im-client/packages/im-sdk-rn/src/adapters/appStateLifecycle.ts`
- Modify: `im-client/packages/im-sdk-rn/src/createSdk.ts`

- [ ] 将生命周期端口改为可注册多个监听者并返回 disposer。
- [ ] 连接成功与前台恢复时触发 `syncAll()`；创建 SDK 时返回 `sync`。
- [ ] 提交 `feat(im-client): 装配连接与前台自动同步（M3 Task3）`。

## Task 4: 会话列表 UI 与导航

**Files:**
- Create: `im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/navigation/types.ts`
- Modify: `im-client/packages/app-mobile/App.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ContactsScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

- [ ] 登录后以会话列表为首页，显示摘要、未读数、同步错误和下拉刷新。
- [ ] 单聊从 cid 解析对端 id；群聊显示群号，二者均可进入现有聊天页。
- [ ] “新建会话”进入联系人页；联系人选中后跳转聊天页。
- [ ] 聊天页进入时先同步当前 cid，再刷新 SQLite 消息。
- [ ] 提交 `feat(im-client): 增加会话列表与离线刷新交互（M3 Task4）`。

## Task 5: 静态校验与手工验收清单

**Files:**
- Modify: `.superpowers/sdd/progress.md`

- [ ] 运行 core 与 app-mobile TypeScript 类型检查。
- [ ] 检查 core 无平台 import。
- [ ] 记录实际提交与未执行自动化测试说明。
- [ ] 输出用户手工测试清单：会话列表、离线补拉、回前台、重复同步、网络失败保留旧数据、杀进程持久化。
