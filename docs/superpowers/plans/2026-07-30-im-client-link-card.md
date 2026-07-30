# IM 客户端链接卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SDK 将后端异步 `LINK_PREVIEW` 安全、幂等地合并到 SQLite 原文本消息，并在 React Native 聊天页展示可由系统浏览器打开的无缩略图链接卡片。

**Architecture:** SDK Core 提供共享的链接卡片规范化函数，实时增量和 REST 同步都经过同一校验；`SyncEngine` 通过 `MessageStore` 合并正文，并用有界、短期内存缓存处理增量早于原消息的乱序。移动端只消费规范化卡片，原正文继续由 `MentionText` 渲染，独立组件负责卡片展示和系统浏览器打开。

**Tech Stack:** TypeScript 5.x、SQLite 端口、React Native 0.86、React 19、React Native `Linking`、现有 `@im/sdk-core` 事件与消息存储。

## Global Constraints

- 不修改已完成的后端链接抓取、Redis 缓存和 SSRF 防护。
- 一条 `TEXT` 消息只展示首个 URL 的一张卡片。
- 卡片只保存 `url`、`title`、可选 `description`、可选 `siteName`；忽略且不请求 `image`。
- `url` 最多 2048 个 UTF-16 代码单元；`title`、`siteName` 最多 200 个；`description` 最多 300 个。
- 只允许系统默认浏览器打开 `http:` 和 `https:`，不接入 WebView。
- `LINK_PREVIEW` 不推进同步序号、会话序号、未读数、已读位点或会话排序。
- 乱序暂存最多 100 项、60 秒，进程退出后由 REST 同步恢复。
- 不新增或运行 Jest、Vitest、JUnit、E2E 等自动化测试；只执行类型检查、现有 ESLint 和 `git diff --check`。
- Git 提交标题使用中文，只提交本计划涉及的文件，不包含现有两处后端工作区改动，不主动 push。

---

## 文件结构

- 新建 `im-client/packages/im-sdk-core/src/chat/linkCard.ts`：链接卡片类型、字段规范化、TEXT 正文卡片清洗的唯一实现。
- 修改 `im-client/packages/im-sdk-core/src/index.ts`：导出链接卡片接口和纯函数供移动端复用。
- 修改 `im-client/packages/im-sdk-core/src/protocol/types.ts`：加入只接收的 `LINK_PREVIEW` 操作码。
- 修改 `im-client/packages/im-sdk-core/src/store/messageStore.ts`：按 `cid + seq` 安全合并卡片，区分更新、缺失和拒绝。
- 修改 `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`：规范化实时/REST 正文，处理增量帧、乱序暂存和消息刷新。
- 修改 `im-client/packages/im-sdk-core/src/chat/chatService.ts`：把 `LINK_PREVIEW` 路由到同步引擎并在停止时清理暂存。
- 新建 `im-client/packages/app-mobile/src/components/LinkCardContent.tsx`：无缩略图卡片与系统浏览器打开交互。
- 修改 `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`：TEXT 正文下追加卡片并显示中文打开失败提示。
- 修改 `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`：记录链接卡片完成状态、关键文件、验证结果和手测清单。

### Task 1: 统一卡片契约并持久化增量元数据

**Files:**
- Create: `im-client/packages/im-sdk-core/src/chat/linkCard.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`
- Modify: `im-client/packages/im-sdk-core/src/store/messageStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`

**Interfaces:**
- Produces: `LinkCard`, `normalizeLinkCard(value: unknown): LinkCard | null`、`normalizeTextMessageBody(body: Record<string, unknown> | null): Record<string, unknown> | null`。
- Produces: `MessageStore.mergeLinkPreview(cid: string, seq: number, link: LinkCard): Promise<'updated' | 'missing' | 'ignored'>`。
- Produces: `SyncEngine.applyLinkPreview(env: Envelope): Promise<void>` 与 `SyncEngine.clearPendingLinkPreviews(): void`。
- Consumes: 现有 `Database`、`MessageStore.upsertMessage`、`SdkEvents.message` 与 `StoredMessage`。

- [ ] **Step 1: 新建共享卡片规范化模块**

在 `chat/linkCard.ts` 定义精确契约：

```ts
export interface LinkCard {
  url: string;
  title: string;
  description?: string;
  siteName?: string;
}

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_SITE_NAME_LENGTH = 200;

interface ParsedUrl {
  protocol: string;
  hostname: string;
  toString(): string;
}

type UrlConstructor = new (value: string) => ParsedUrl;

function parseUrl(value: string): ParsedUrl | null {
  const Url = (globalThis as unknown as { URL?: UrlConstructor }).URL;
  if (Url == null) return null;
  try {
    return new Url(value);
  } catch {
    return null;
  }
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized === '') return undefined;
  return normalized.slice(0, maxLength);
}

export function normalizeLinkCard(value: unknown): LinkCard | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== 'string' || raw.url.length > MAX_URL_LENGTH) return null;
  const parsed = parseUrl(raw.url);
  if (parsed == null || parsed.hostname === '') return null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const title = optionalText(raw.title, MAX_TITLE_LENGTH);
  if (title == null) return null;
  const description = optionalText(raw.description, MAX_DESCRIPTION_LENGTH);
  const siteName = optionalText(raw.siteName, MAX_SITE_NAME_LENGTH);
  return {
    url: parsed.toString(),
    title,
    ...(description == null ? {} : { description }),
    ...(siteName == null ? {} : { siteName }),
  };
}

export function normalizeTextMessageBody(
  body: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (body == null || !Object.prototype.hasOwnProperty.call(body, 'link')) return body;
  const { link: rawLink, ...rest } = body;
  const link = normalizeLinkCard(rawLink);
  return link == null ? rest : { ...rest, link };
}
```

该模块不得复制或保留 `image`，也不得接受无主机名、相对 URL、非 HTTP 协议、空标题或超长 URL。通过 `globalThis.URL` 的窄接口适配是因为 SDK Core 的 `tsconfig` 只启用 `ES2022`、没有 DOM 类型；不得为此修改全局 TypeScript lib。在 `src/index.ts` 增加 `export * from './chat/linkCard';`。

- [ ] **Step 2: 给 MessageStore 增加原子语义的正文合并方法**

在 `messageStore.ts` 导入 `LinkCard`，新增：

```ts
export type LinkPreviewMergeResult = 'updated' | 'missing' | 'ignored';

async mergeLinkPreview(
  cid: string,
  seq: number,
  link: LinkCard,
): Promise<LinkPreviewMergeResult> {
  const rows = await this.db.query<Row>(
    `SELECT type, body_json, recalled FROM messages WHERE cid = ? AND seq = ?`,
    [cid, seq],
  );
  if (rows.length === 0) return 'missing';
  const row = rows[0];
  if (row.type !== 'TEXT' || row.recalled === 1 || row.body_json == null) return 'ignored';
  let body: unknown;
  try {
    body = JSON.parse(row.body_json as string);
  } catch {
    return 'ignored';
  }
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return 'ignored';
  await this.db.exec(
    `UPDATE messages SET body_json = ? WHERE cid = ? AND seq = ? AND recalled = 0`,
    [JSON.stringify({ ...(body as Record<string, unknown>), link }), cid, seq],
  );
  return 'updated';
}
```

更新条件必须再次包含 `recalled = 0`，避免读取与写入之间发生撤回时把正文补回。

- [ ] **Step 3: 在 SyncEngine 统一清洗 PUSH 与 REST 正文**

在 `syncEngine.ts` 导入 `LinkCard`、`normalizeLinkCard` 和 `normalizeTextMessageBody`。`applyPush` 构造 `StoredMessage` 时仅对 `env.type ?? 'TEXT'` 为 `TEXT` 的正文执行 `normalizeTextMessageBody`；`applyRestMessage` 同样只清洗 `message.type === 'TEXT'` 的正文。非 TEXT 正文保持原样。

将逻辑收口为私有方法，避免实时与 REST 分支漂移：

```ts
private normalizeBody(
  type: string,
  body: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return type === 'TEXT' ? normalizeTextMessageBody(body) : body;
}
```

- [ ] **Step 4: 实现有界乱序暂存和增量落库**

在 `SyncEngine` 增加：

```ts
interface PendingLinkPreview {
  link: LinkCard;
  expiresAt: number;
}

private readonly pendingLinkPreviews = new Map<string, PendingLinkPreview>();
private static readonly MAX_PENDING_LINK_PREVIEWS = 100;
private static readonly PENDING_LINK_PREVIEW_TTL_MS = 60_000;
```

键使用 `${cid}\u0000${seq}`。`applyLinkPreview` 校验 `cid`、正安全整数 `seq` 和 `normalizeLinkCard(env.body?.link)`；调用 `MessageStore.mergeLinkPreview` 后：

- `updated`：发出 `this.emitter.emit('message', { cid, type: 'TEXT' })`。
- `ignored`：直接结束。
- `missing`：先删除所有过期项；容量达到 100 时删除 `Map.keys().next().value` 指向的最早项；再写入 60 秒后过期的新项。

用以下私有辅助方法实现容量、过期和类型安全边界：

```ts
private linkPreviewKey(cid: string, seq: number): string {
  return `${cid}\u0000${seq}`;
}

private prunePendingLinkPreviews(now: number): void {
  this.pendingLinkPreviews.forEach((entry, key) => {
    if (entry.expiresAt <= now) this.pendingLinkPreviews.delete(key);
  });
}

private savePendingLinkPreview(cid: string, seq: number, link: LinkCard): void {
  const now = Date.now();
  this.prunePendingLinkPreviews(now);
  const key = this.linkPreviewKey(cid, seq);
  this.pendingLinkPreviews.delete(key);
  if (this.pendingLinkPreviews.size >= SyncEngine.MAX_PENDING_LINK_PREVIEWS) {
    const oldestKey = this.pendingLinkPreviews.keys().next().value;
    if (typeof oldestKey === 'string') this.pendingLinkPreviews.delete(oldestKey);
  }
  this.pendingLinkPreviews.set(key, {
    link,
    expiresAt: now + SyncEngine.PENDING_LINK_PREVIEW_TTL_MS,
  });
}

private takePendingLinkPreview(cid: string, seq: number): LinkCard | null {
  const key = this.linkPreviewKey(cid, seq);
  const pending = this.pendingLinkPreviews.get(key);
  this.pendingLinkPreviews.delete(key);
  return pending != null && pending.expiresAt > Date.now() ? pending.link : null;
}
```

`applyStored` 在进入数据库事务前取出同键暂存项。只有 `stored.type === 'TEXT'`、`!stored.recalled`、正文为非数组对象且暂存未过期时，才把卡片合并到即将落库的正文。无论目标是否可合并，都删除该暂存项，避免错误类型永久占用容量。

新增：

```ts
clearPendingLinkPreviews(): void {
  this.pendingLinkPreviews.clear();
}
```

- [ ] **Step 5: 执行 Task 1 静态检查并审查差异**

运行：

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
git diff --check
git diff -- packages/im-sdk-core/src
```

预期：TypeScript 与空白检查退出码为 0；差异只包含卡片契约、MessageStore、SyncEngine 和导出，不包含测试文件或后端文件。

- [ ] **Step 6: 提交 SDK 持久化能力**

```bash
git add \
  im-client/packages/im-sdk-core/src/chat/linkCard.ts \
  im-client/packages/im-sdk-core/src/index.ts \
  im-client/packages/im-sdk-core/src/store/messageStore.ts \
  im-client/packages/im-sdk-core/src/engine/syncEngine.ts
git commit -m "功能(IM客户端)：持久化链接卡片增量"
```

### Task 2: 路由 LINK_PREVIEW 下行帧

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/protocol/types.ts`
- Modify: `im-client/packages/im-sdk-core/src/chat/chatService.ts`

**Interfaces:**
- Consumes: Task 1 的 `SyncEngine.applyLinkPreview(env)` 与 `clearPendingLinkPreviews()`。
- Produces: `OP.LINK_PREVIEW = 'LINK_PREVIEW'`，并保证帧进入现有串行下行队列。

- [ ] **Step 1: 扩展协议操作码**

在 `OP` 常量的服务端下行操作区域加入：

```ts
LINK_PREVIEW: 'LINK_PREVIEW',
```

`Op` 继续由常量值联合自动推导；不得把 `LINK_PREVIEW` 加入 `MessageType`，因为它不是消息类型。

- [ ] **Step 2: 在现有串行帧处理器中路由增量**

在 `ChatService.onEnvelope` 的 `PUSH` 分支之前加入：

```ts
if (env.op === OP.LINK_PREVIEW) {
  await this.engine.applyLinkPreview(env);
  return;
}
```

这必须复用构造器已经建立的 `enqueue(() => this.onEnvelope(env))` 串行链，不能新增独立监听或 fire-and-forget 数据库写入。

- [ ] **Step 3: 在 SDK 停止时清除跨账号暂存**

在 `ChatService.stop()` 清理计时器和待撤回状态后调用：

```ts
this.engine.clearPendingLinkPreviews();
```

确保登出、SDK 卸载或账号切换后不会把旧账号的乱序卡片补到新账号本地库。

- [ ] **Step 4: 执行 Task 2 静态检查并审查差异**

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
git diff --check
git diff -- packages/im-sdk-core/src/protocol/types.ts packages/im-sdk-core/src/chat/chatService.ts
```

预期：退出码均为 0；`LINK_PREVIEW` 只作为操作码和下行路由存在，不出现在消息类型或发送分支。

- [ ] **Step 5: 提交帧路由**

```bash
git add \
  im-client/packages/im-sdk-core/src/protocol/types.ts \
  im-client/packages/im-sdk-core/src/chat/chatService.ts
git commit -m "功能(IM客户端)：接入链接卡片增量帧"
```

### Task 3: 展示无缩略图链接卡片并打开系统浏览器

**Files:**
- Create: `im-client/packages/app-mobile/src/components/LinkCardContent.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: Task 1 从 `@im/sdk-core` 导出的 `normalizeLinkCard`、`LinkCard` 与现有 `ChatMessage`。
- Produces: `LinkCardContent({ body, onOpenError })`；合法卡片展示并打开，非法或缺失卡片返回 `null`。

- [ ] **Step 1: 新建链接卡片组件**

实现 `LinkCardContent.tsx`：

```tsx
import React, { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { normalizeLinkCard, type ChatMessage } from '@im/sdk-core';
import { COLORS, RADIUS, SPACING, TYPE } from '../ui/theme';

interface Props {
  body: ChatMessage['body'];
  onOpenError: () => void;
}

export function LinkCardContent({ body, onOpenError }: Props) {
  const card = useMemo(() => normalizeLinkCard(body?.link), [body?.link]);
  const host = useMemo(() => {
    if (card == null) return '';
    try {
      return new URL(card.url).hostname;
    } catch {
      return '';
    }
  }, [card]);
  if (card == null) return null;

  const open = async () => {
    const safeCard = normalizeLinkCard(card);
    if (safeCard == null) {
      onOpenError();
      return;
    }
    try {
      await Linking.openURL(safeCard.url);
    } catch {
      onOpenError();
    }
  };

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`打开链接：${card.title}`}
      onPress={() => void open()}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.site} numberOfLines={1}>{card.siteName ?? host}</Text>
      <Text style={styles.title} numberOfLines={2}>{card.title}</Text>
      {card.description == null ? null : (
        <Text style={styles.description} numberOfLines={2}>{card.description}</Text>
      )}
    </Pressable>
  );
}
```

样式使用 `COLORS.surfaceMuted`、`COLORS.borderStrong`、`COLORS.text`、`COLORS.textSecondary`，`RADIUS.sm` 和现有间距；卡片顶部与正文留 `SPACING.xs`，宽度不超过气泡内容宽度，按压态只降低透明度。不得导入 `Image` 或读取 `body.link.image`。

- [ ] **Step 2: 在 TEXT 正文下追加卡片**

在 `ChatScreen.tsx` 导入 `LinkCardContent`。把现有最终的 `MentionText` 回退分支改成：

```tsx
<View>
  <MentionText body={item.body} />
  {item.type === 'TEXT' ? (
    <LinkCardContent
      body={item.body}
      onOpenError={() => showBanner('无法打开此链接')}
    />
  ) : null}
</View>
```

语音、图片、文件分支保持原样。只有 `TEXT` 尝试展示卡片，`SYSTEM` 和已撤回消息仍在更早分支返回，不可出现卡片。

- [ ] **Step 3: 执行移动端静态检查并审查差异**

```bash
cd im-client
npx tsc -p packages/app-mobile --noEmit
npm run lint --workspace packages/app-mobile
git diff --check
git diff -- packages/app-mobile/src/components/LinkCardContent.tsx packages/app-mobile/src/screens/ChatScreen.tsx
```

预期：退出码均为 0；没有新增依赖、权限、WebView、`Image`、网络抓取或测试文件。若 ESLint 仅报告仓库既有问题，记录具体文件和规则，不修改无关文件。

- [ ] **Step 4: 提交移动端卡片展示**

```bash
git add \
  im-client/packages/app-mobile/src/components/LinkCardContent.tsx \
  im-client/packages/app-mobile/src/screens/ChatScreen.tsx
git commit -m "功能(IM客户端)：展示并打开链接卡片"
```

### Task 4: 更新交接文档并完成静态验证

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`

**Interfaces:**
- Consumes: Tasks 1–3 的最终文件和静态检查结果。
- Produces: 下一窗口可直接接手的完成状态、关键提交、文件索引、已知限制和手测清单。

- [ ] **Step 1: 更新交接状态**

把文档顶部和“下一窗口优先处理的边界”中的链接卡片改为“代码已完成，等待用户手测”。在完成功能列表记录：

- `LINK_PREVIEW` 按原消息 `cid + seq` 持久化合并，不推进消息或会话位点。
- 实时/REST 使用同一合法化规则，重复帧幂等，早到帧用 100 项/60 秒暂存。
- 卡片无缩略图，点击只通过系统默认浏览器打开 `http(s)`。
- 所有抓取、字段和打开失败均降级为纯文本或中文提示。

补充关键文件 `chat/linkCard.ts`、`LinkCardContent.tsx`，记录 Tasks 1–3 的中文提交哈希，并把本计划与设计规范加入文档索引。

- [ ] **Step 2: 写入链接卡片手测清单**

逐项写入设计规范的十项手测场景：异步补卡、无缩略图内容、系统浏览器、首个链接、单聊群聊、离线恢复、失败降级、撤回、提及共存、重复帧与位点不变。明确这些场景由用户执行，不能写成自动测试已通过。

- [ ] **Step 3: 执行最终静态验证**

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
npm run lint --workspace packages/app-mobile
cd ..
git diff --check
git status --short
```

预期：静态命令退出码为 0；状态只保留用户原有两处后端改动和本任务尚未提交的交接文档。不得运行任何测试命令。

- [ ] **Step 4: 审查安全与范围**

使用 `git show --stat --oneline HEAD~3..HEAD` 和针对本轮文件的 `git diff`/`git show`，确认：

- 未请求或渲染 `image`。
- 未接受 `http(s)` 之外的协议。
- 未把 `LINK_PREVIEW` 当成新消息推进位点。
- 未覆盖正文、提及范围或撤回状态。
- 未新增 token、密钥、日志或依赖。
- 未暂存 `backend/src/main/java/com/rbac/im/entity/ImConversationMember.java` 与 `backend/src/main/java/com/rbac/im/service/ConversationService.java`。

- [ ] **Step 5: 提交交接文档**

```bash
git add docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md
git commit -m "文档(IM客户端)：记录链接卡片开发状态"
```

- [ ] **Step 6: 向用户交付手测说明**

最终回复列出实现结果、静态检查结果、未运行测试的说明、四个本地提交和十项手测清单；明确没有 push，并说明用户现有两处后端改动保持未提交且未被修改。
