# IM 客户端群聊 @ 提及 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 React Native 群聊实现可搜索、多选、可准确区分重名成员的 `@成员` 与管理员 `@所有人`，并完成发送、展示、提醒和失败重发闭环。

**Architecture:** SDK Core 用独立协议构造器规范化 `mentions`、`mentionAll` 和 `mentionRanges`，现有 outbox 原样持久化结构化 body。移动端用纯函数维护文本与提及范围，以独立成员面板完成选择，再由专用文本组件安全校验并高亮下行消息。

**Tech Stack:** TypeScript 5.8、React 19、React Native 0.86、Zustand、SQLite outbox、现有 REST/WebSocket IM 协议。

## Global Constraints

- 仅群聊触发提及；单聊继续发送纯文本。
- 支持成员名称搜索、多选、去重和重名成员。
- `@所有人` 只向 `OWNER`、`ADMIN` 展示，并与普通成员提及互斥。
- 提及范围使用 JavaScript UTF-16 字符串下标。
- 不新增依赖。
- 不新增或运行自动化测试；只执行 TypeScript、相关编译和差异检查，视觉交互由用户验收。
- Git 提交标题和开发记录统一使用中文，只提交本地分支，不主动 push。

---

## 文件结构

- Create: `im-client/packages/im-sdk-core/src/chat/mentionPayload.ts` — 提及协议类型、字段规范化和 TEXT body 构造。
- Modify: `im-client/packages/im-sdk-core/src/chat/chatService.ts` — `sendText` 接收可选提及参数。
- Modify: `im-client/packages/im-sdk-core/src/index.ts` — 导出提及协议接口。
- Create: `im-client/packages/app-mobile/src/mention/mentionDraft.ts` — 草稿范围插入、编辑失效、去重和发送参数转换。
- Create: `im-client/packages/app-mobile/src/components/MentionPickerSheet.tsx` — 群成员搜索与多选面板。
- Create: `im-client/packages/app-mobile/src/components/MentionText.tsx` — 安全解析并高亮 `mentionRanges`。
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx` — 装配成员数据、触发器、选择面板、发送与错误文案。
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md` — 记录功能完成状态、提交和手测清单。

### Task 1: SDK Core 结构化提及消息体

**Files:**
- Create: `im-client/packages/im-sdk-core/src/chat/mentionPayload.ts`
- Modify: `im-client/packages/im-sdk-core/src/chat/chatService.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`

**Interfaces:**
- Produces: `TextMentionRange`、`SendTextOptions`、`buildTextMessageBody(text, options)`。
- Produces: `ChatService.sendText(cid, text, options?)`；原有两个参数调用保持兼容。

- [ ] **Step 1: 定义协议类型和规范化入口**

在 `mentionPayload.ts` 定义：

```ts
export type TextMentionRange =
  | { userId: number; start: number; end: number }
  | { mentionAll: true; start: number; end: number };

export interface SendTextOptions {
  mentions?: readonly number[];
  mentionAll?: boolean;
  mentionRanges?: readonly TextMentionRange[];
}

export function buildTextMessageBody(
  text: string,
  options: SendTextOptions = {},
): Record<string, unknown>;
```

实现要求：过滤非正安全整数并去重；`mentionAll === true` 时不输出 `mentions`；只保留边界有效、以 `@` 开头、与有效目标对应且互不重叠的范围；无提及时只返回 `{ text }`。

- [ ] **Step 2: 扩展发送入口**

将 `ChatService.sendText` 改为：

```ts
async sendText(
  cid: string,
  text: string,
  options: SendTextOptions = {},
): Promise<string>
```

outbox 的 `body` 使用 `buildTextMessageBody(text, options)`；`resend` 保持直接复用原始 row，不重新构建提及字段。

- [ ] **Step 3: 导出公共接口并执行静态检查**

从 SDK Core `index.ts` 导出 `mentionPayload.ts`，然后执行：

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
git diff --check
```

预期：命令退出码均为 0；未运行测试。

- [ ] **Step 4: 中文提交**

```bash
git add im-client/packages/im-sdk-core/src/chat/mentionPayload.ts im-client/packages/im-sdk-core/src/chat/chatService.ts im-client/packages/im-sdk-core/src/index.ts
git commit -m "功能(IM SDK)：支持发送结构化提及"
```

### Task 2: 提及草稿纯函数模型

**Files:**
- Create: `im-client/packages/app-mobile/src/mention/mentionDraft.ts`

**Interfaces:**
- Consumes: `SendTextOptions`、`TextMentionRange`。
- Produces: `MentionDraftState`、`MentionCandidate`、`MentionTrigger`。
- Produces: `findInsertedMentionTrigger`、`applyMentionTextChange`、`insertMentionSelection`、`toSendTextOptions`。

- [ ] **Step 1: 定义草稿模型**

```ts
export interface MentionDraftRange {
  userId?: number;
  mentionAll?: true;
  displayName: string;
  start: number;
  end: number;
}

export interface MentionDraftState {
  text: string;
  ranges: readonly MentionDraftRange[];
}

export interface MentionCandidate {
  userId: number;
  displayName: string;
}

export interface MentionTrigger {
  start: number;
  end: number;
}
```

- [ ] **Step 2: 实现单次文本编辑协调**

`applyMentionTextChange(state, nextText)` 用最长公共前缀和最长公共后缀定位单次编辑区：编辑区之前的范围保持不变，之后的范围整体平移，与编辑区相交的范围移除绑定。返回新对象和新数组，不原地修改状态。

同文件实现：

```ts
export function findInsertedMentionTrigger(
  previousText: string,
  nextText: string,
): MentionTrigger | null;
```

它复用同一段差异定位逻辑，仅当本次替换区域插入的内容严格等于单个 `@` 时返回 `{ start, end: start + 1 }`，粘贴含 `@` 的长文本不触发面板。

- [ ] **Step 3: 实现成员插入和互斥规则**

`insertMentionSelection(state, trigger, selection)` 返回：

```ts
{
  state: MentionDraftState;
  cursor: number;
}
```

普通成员选择过滤当前有效范围中已有的 userId，按面板选择顺序插入 `@显示名 `。选择所有人时移除现有普通成员范围绑定但保留其文字，只为新插入的 `@所有人` 建立范围。

- [ ] **Step 4: 构建 SDK 参数并检查类型**

`toSendTextOptions(state)` 按范围起点排序，输出普通成员 ID、`mentionAll` 和协议范围；空范围返回 `{}`。

```bash
cd im-client
npx tsc -p packages/app-mobile --noEmit
git diff --check
```

预期：退出码均为 0；未运行测试。

- [ ] **Step 5: 中文提交**

```bash
git add im-client/packages/app-mobile/src/mention/mentionDraft.ts
git commit -m "功能(IM客户端)：增加提及草稿模型"
```

### Task 3: 群成员提及选择面板

**Files:**
- Create: `im-client/packages/app-mobile/src/components/MentionPickerSheet.tsx`

**Interfaces:**
- Consumes: SDK Core `GroupMember`、`GroupRole`。
- Produces: `MentionPickerSelection` 和受控 `MentionPickerSheet` 组件。

- [ ] **Step 1: 定义面板接口**

```ts
export type MentionPickerSelection =
  | { kind: 'members'; members: GroupMember[] }
  | { kind: 'all' };

interface Props {
  visible: boolean;
  members: readonly GroupMember[];
  myId: number | null;
  myRole: GroupRole | null;
  excludedUserIds: ReadonlySet<number>;
  onClose: () => void;
  onConfirm: (selection: MentionPickerSelection) => void;
}
```

- [ ] **Step 2: 实现搜索和多选**

复用现有底部 Modal 视觉：标题“提及成员”、关闭按钮、搜索输入框、成员 FlatList、选中复选框和底部“确定（N）”。搜索值 `trim()` 后按 `displayName` 包含匹配；排除 `myId` 和 `excludedUserIds`；空结果显示“没有匹配的群成员”。

- [ ] **Step 3: 实现所有人权限和互斥**

仅当 `myRole === 'OWNER' || myRole === 'ADMIN'` 时在列表顶部显示“所有人”。点击后清空普通成员选择并进入 all 状态；选择任一成员时退出 all 状态。关闭或 visible 从 false 变 true 时重置搜索和本次选择。

- [ ] **Step 4: 执行静态检查并中文提交**

```bash
cd im-client
npx tsc -p packages/app-mobile --noEmit
git diff --check
git add packages/app-mobile/src/components/MentionPickerSheet.tsx
git commit -m "功能(IM客户端)：新增群成员提及面板"
```

预期：检查退出码均为 0；未运行测试。

### Task 4: 消息提及安全展示

**Files:**
- Create: `im-client/packages/app-mobile/src/components/MentionText.tsx`

**Interfaces:**
- Consumes: `ChatMessage.body` 中的 `text`、`mentions`、`mentionAll`、`mentionRanges`。
- Produces: `MentionText({ body, mine })`。

- [ ] **Step 1: 实现范围解析器**

在组件文件内定义不导出的 `parseMentionSegments(body)`。先完整校验所有范围的安全整数、边界、排序、不重叠、目标一致和 `@` 前缀，再返回：

```ts
type Segment = { text: string; mentioned: boolean };
```

任一范围无效或缺少范围时返回单个普通文本片段，不能部分采信。

- [ ] **Step 2: 实现嵌套文本渲染**

`MentionText` 外层沿用己方白字、对端深色；提及片段在己方气泡中使用加粗白字和半透明底色，在对端气泡中使用 `COLORS.primary`、`COLORS.primarySoft`。保留现有 `TYPE.body` 与 21 行高。

- [ ] **Step 3: 执行静态检查并中文提交**

```bash
cd im-client
npx tsc -p packages/app-mobile --noEmit
git diff --check
git add packages/app-mobile/src/components/MentionText.tsx
git commit -m "功能(IM客户端)：展示消息提及片段"
```

预期：检查退出码均为 0；未运行测试。

### Task 5: 聊天页面接入提及闭环

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: `MentionDraftState` 纯函数、`MentionPickerSheet`、`MentionText`、扩展后的 `sendText`。
- Produces: 群聊从输入 `@` 到选择、发送、展示、提醒错误的完整交互。

- [ ] **Step 1: 保存完整群成员和加载状态**

在现有群资料请求中增加 `groupMembers: GroupMember[]`、`membersLoading`、`membersLoadFailed` 状态。切换 cid 时清空旧成员；成功时同时维护现有 `namesById` 与 `myGroupRole`。

- [ ] **Step 2: 接入草稿、光标和触发器**

用 `MentionDraftState` 替代字符串 `draft`，新增 `{start, end}` 选择区和 `MentionTrigger | null`。`onChangeText` 先调用 `findInsertedMentionTrigger` 再调用 `applyMentionTextChange`；仅群聊且触发函数返回非空时记录触发器并打开面板。`onSelectionChange` 保存光标，切换会话时清空全部提及状态。

- [ ] **Step 3: 接入面板确认与发送**

面板确认时调用 `insertMentionSelection`，更新草稿并把光标移到插入内容末尾。发送调用：

```ts
await sdk.chat.sendText(cid, text, toSendTextOptions(draftState));
```

发送前仍对整段文本 `trim()` 判空，但不得 trim 实际发送文本，否则范围会错位。发起发送后清空草稿与提及状态。

- [ ] **Step 4: 接入展示和中文错误**

将气泡中的纯 `Text` 替换为 `MentionText`。扩展发送错误映射：`MENTION_NOT_MEMBER` 显示“提及的成员已不在群聊中”，`MENTION_ALL_FORBIDDEN` 显示“只有群主或管理员可以@所有人”；其他错误保持现有文案。

- [ ] **Step 5: 执行客户端完整静态检查**

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
git diff --check
```

预期：所有命令退出码为 0；未运行测试和视觉验证。

- [ ] **Step 6: 中文提交**

```bash
git add im-client/packages/app-mobile/src/screens/ChatScreen.tsx
git commit -m "功能(IM客户端)：接入群聊提及交互"
```

### Task 6: 开发记录与交付检查

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`

**Interfaces:**
- Consumes: Tasks 1-5 的最终提交和静态检查结果。
- Produces: 下一窗口可直接接手富媒体消息的准确状态。

- [ ] **Step 1: 更新交接记录**

记录 @ 提及客户端已完成、关键提交、未运行自动化测试、用户需手测的 11 个场景，并将下一开发目标调整为图片、语音、文件等富媒体消息。

- [ ] **Step 2: 最终检查**

```bash
git diff --check
git status --short
git log -8 --oneline
```

确认只包含本任务文档改动；代码已在各任务提交中完成并通过静态检查。

- [ ] **Step 3: 中文提交**

```bash
git add docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md
git commit -m "文档(IM客户端)：记录群聊提及开发完成"
```

- [ ] **Step 4: 交给用户验收**

明确说明未执行自动化或视觉测试，并提供设计文档“验证方式”中的 11 项手测清单。验收通过后再开始第三项富媒体消息设计。
