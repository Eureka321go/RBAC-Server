# IM 完整通讯录与部门层级选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供无后台管理权限依赖的完整 IM 通讯录，并用部门层级选择器统一单聊、建群和群加人流程，同时让群 SYSTEM 消息显示姓名。

**Architecture:** 后端新增一次返回启用部门和启用成员的扁平通讯录接口；SDK Core 封装类型与请求；RN 在本地构建安全的部门树和 ID→姓名索引。SYSTEM 消息生成时固化姓名，客户端对旧消息使用通讯录映射兜底。

**Tech Stack:** Java 21、Spring Boot、MyBatis-Plus、TypeScript、React Native 0.86、React Navigation 7。

## Global Constraints

- `GET /api/im/contacts` 只要求登录，不使用后台管理权限码或数据范围过滤。
- 只返回 `ENABLED` 部门和用户，不暴露手机号、邮箱、角色、岗位等字段。
- 后端返回扁平 `departments + members`；树构建和成员匹配由前端完成。
- 前端树遍历必须防循环；孤儿成员进入“未分配部门”。
- 当前用户和禁用成员不得进入最终选择结果，userId 始终去重。
- 保留手工 userId 输入兜底和现有群角色服务端校验。
- 按用户约定不新增或运行自动化测试，只执行跳过测试的后端构建、TypeScript 类型检查和静态检查。

---

### Task 1: 后端完整通讯录接口

**Files:**
- Create: `backend/src/main/java/com/rbac/im/controller/ImContactController.java`
- Create: `backend/src/main/java/com/rbac/im/service/ImContactService.java`
- Create: `backend/src/main/java/com/rbac/im/vo/ImContactDirectoryVO.java`
- Create: `backend/src/main/java/com/rbac/im/vo/ImContactDepartmentVO.java`
- Create: `backend/src/main/java/com/rbac/im/vo/ImContactMemberVO.java`

**Interfaces:**
- Consumes: `SysDeptMapper`、`SysUserMapper` 与逻辑删除默认过滤。
- Produces: `GET /im/contacts -> Result<ImContactDirectoryVO>`。

- [x] 查询 `status = ENABLED` 的部门与用户，各固定一次数据库查询。
- [x] 部门输出 `id/parentId/name/sortOrder`，成员输出 `userId/deptId/username/displayName/avatar`。
- [x] 展示名按“非空 nickname → username”计算并稳定排序。
- [x] Controller 不加 `@PreAuthorize`，依赖全局 JWT 登录保护。
- [x] 运行 `mvn -f backend/pom.xml -Dmaven.test.skip=true package` 并提交 `feat(im): add complete contact directory endpoint`。

### Task 2: 群成员与 SYSTEM 姓名契约

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/ConversationService.java`
- Modify: `backend/src/main/java/com/rbac/im/service/GroupService.java`
- Modify: `backend/src/main/java/com/rbac/im/vo/ImGroupMemberVO.java`
- Modify: `im-client/packages/im-sdk-core/src/group/groupService.ts`
- Modify: `im-client/packages/app-mobile/src/group/systemMessage.ts`

**Interfaces:**
- Produces: `ConversationService.displayNames(Collection<Long>)`、`GroupMember.displayName`、SYSTEM `operatorName/targetNames`。

- [x] 在 `ConversationService` 批量查询 ID→展示名，空 ID 集合零查询。
- [x] `listMembers` 一次批量补齐所有成员 `displayName`，不得逐成员查询。
- [x] `postSystem` 固化 `operatorName` 和与 `targetIds` 对齐的 `targetNames`。
- [x] 客户端格式化优先消息内姓名，再使用调用方提供的通讯录映射，最后回退 `用户 #ID`。
- [x] 运行后端跳过测试构建和两套 TypeScript 类型检查，提交 `fix(im): include names in group system messages`。

### Task 3: SDK 通讯录服务与前端树模型

**Files:**
- Create: `im-client/packages/im-sdk-core/src/contact/contactService.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`
- Modify: `im-client/packages/im-sdk-rn/src/createSdk.ts`
- Replace: `im-client/packages/app-mobile/src/services/users.ts`
- Create: `im-client/packages/app-mobile/src/contact/directory.ts`

**Interfaces:**
- Produces: `ContactDirectory`、`ContactDepartment`、`ContactMember`、`sdk.contacts.getDirectory()`、`buildContactDirectory(directory)`。

- [x] SDK 校验 `Result.code` 和两个数组后返回通讯录。
- [x] RN SDK 工厂装配 `contacts`，core 保持无平台依赖。
- [x] 树模型生成根部门、子部门索引、直属成员索引、所有后代成员索引和姓名索引。
- [x] 父节点缺失、自环或多节点环均安全提升为根节点，不允许递归死循环。
- [x] 运行两套 TypeScript 类型检查并提交 `feat(im-client): add hierarchical contact directory model`。

### Task 4: 部门层级成员选择器

**Files:**
- Create: `im-client/packages/app-mobile/src/components/DepartmentContactPicker.tsx`
- Delete: `im-client/packages/app-mobile/src/components/UserMultiSelect.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/CreateGroupScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/GroupDetailsScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ContactsScreen.tsx`

**Interfaces:**
- Consumes: Task 3 树模型。
- Produces: 单选/多选部门通讯录 UI。

- [x] 选择器展示面包屑、直属子部门、直属成员、后代可选人数和部门全选/取消。
- [x] 多选模式排除当前用户并禁用已有群成员；单选模式点击成员立即返回。
- [x] 建群页和群加人弹窗改用同一选择器，保留手工 userId 输入。
- [x] 单聊页改用层级单选，接口失败时仍可手工输入 userId。
- [x] 运行移动端 TypeScript 类型检查并提交 `feat(im-client): select contacts by department hierarchy`。

### Task 5: 旧 SYSTEM 消息姓名映射与交付

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/GroupDetailsScreen.tsx`
- Modify: `docs/superpowers/plans/2026-07-29-im-address-book.md`

**Interfaces:**
- Consumes: `sdk.contacts.getDirectory()` 和 `formatGroupSystemMessage(message, namesById)`。

- [x] 群聊聚焦时并行获取群详情、成员与通讯录，构建 ID→姓名映射供旧 SYSTEM 消息使用。
- [x] 群详情成员名称优先服务端 `displayName`，再回退通讯录，最后回退 ID。
- [x] 运行后端跳过测试构建、两套 TypeScript 类型检查、core 平台依赖和 `git diff --check`。
- [x] 勾选计划并记录未运行自动化测试，提交 `docs(im): complete address book implementation plan`。
- [x] 输出多级部门、全选、禁用、旧/新 SYSTEM 姓名与失败兜底手测清单。

## 执行记录

- 完成日期：2026-07-29。
- 后端跳过测试的 Maven 构建成功，core 与 app-mobile TypeScript 类型检查通过。
- core 平台依赖检查无匹配，完整改动范围 `git diff --check` 通过。
- 按用户明确约束，未新增或运行自动化测试；功能由用户按交付清单手工验收。
