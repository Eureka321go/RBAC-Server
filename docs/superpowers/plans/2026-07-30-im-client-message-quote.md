# IM 消息引用实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为单聊和群聊增加由服务端校验快照、客户端可发送/展示/定位/撤回感知的单层消息引用。

**Architecture:** 带引用的回复继续使用 `TEXT body.quote`。SDK Core 负责引用预览构建与下行合法化，服务端只采信 `targetSeq` 并用同会话原消息生成权威快照，移动端负责选择引用、输入区预览、气泡展示和本地定位。

**Tech Stack:** Java 21、Spring Boot、Spring Data MongoDB、Kafka、TypeScript 5.8、React Native 0.86、SQLite outbox、Zustand。

## Global Constraints

- 本期只实现消息引用；消息免打扰和置顶聊天后续分别设计、实施。
- 可引用的目标类型仅为 `TEXT`、`IMAGE`、`FILE`、`AUDIO`，且目标必须已落库、未撤回。
- 引用只附着在新 `TEXT` 消息上；图片、文件和语音发送链路不携带引用。
- 每条消息最多一个单层引用，不递归保存或展示目标消息自身的引用。
- 客户端 outbox 可携带本地预览，但服务端只采信定位字段 `targetSeq`；`senderId`、`senderName`、`type`、`summary` 必须由服务端重新生成。
- `senderName` 最多 80 个 Unicode 码点，`summary` 最多 120 个 Unicode 码点，均清理控制字符并折叠空白。
- 原消息撤回后，既有引用只显示“原消息已撤回”，不展示旧快照摘要。
- 不新增或运行自动化测试；仅运行类型检查、跳过测试的 Java 编译、改动文件 ESLint 和 `git diff --check`。
- 保留用户对 `backend/src/main/java/com/rbac/im/entity/ImConversationMember.java` 和 `backend/src/main/java/com/rbac/im/service/ConversationService.java` 的现有改动，不覆盖、不纳入本功能提交。
- 每个任务提交前查看对应差异；Git 提交标题使用中文；只提交本地分支，不主动 push。

---

## 文件职责映射

- `backend/src/main/java/com/rbac/im/service/QuoteValidationException.java`：承载固定引用错误码。
- `backend/src/main/java/com/rbac/im/service/QuoteService.java`：校验目标、生成服务端引用快照并返回复制后的正文。
- `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`：把引用校验接入现有 SEND 前置链路。
- `im-client/packages/im-sdk-core/src/chat/quotePayload.ts`：引用类型、目标资格判断、本地预览构建和下行合法化。
- `im-client/packages/im-sdk-core/src/chat/mentionPayload.ts`：将引用与文本、提及字段组合成上行正文。
- `im-client/packages/im-sdk-core/src/chat/linkCard.ts`：统一合法化文本正文中的 `link` 与 `quote`。
- `im-client/packages/im-sdk-core/src/index.ts`：导出引用公共接口。
- `im-client/packages/app-mobile/src/components/MessageQuoteContent.tsx`：复用的输入区/气泡引用展示组件。
- `im-client/packages/app-mobile/src/components/MessageActionSheet.tsx`：按目标资格显示“引用”和“撤回”操作。
- `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`：引用选择、发送、错误映射、撤回占位、滚动定位和短暂高亮。
- `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`：记录引用功能实现状态和手测清单。

---

### Task 1: 服务端生成权威引用快照

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/QuoteValidationException.java`
- Create: `backend/src/main/java/com/rbac/im/service/QuoteService.java`
- Modify: `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`

**Interfaces:**
- Consumes: `ImMessageRepository.findByCidAndSeq(String, Long)`、`ConversationService.displayNames(Collection<Long>)`、`Envelope.body`。
- Produces: `Map<String, Object> QuoteService.enrich(String cid, String type, Map<String, Object> body)`；失败时抛出 `QuoteValidationException#getReason()`。

- [ ] **Step 1: 增加固定错误异常**

创建异常类，保持与 `MentionValidationException` 相同的固定 reason 边界：

```java
package com.rbac.im.service;

public class QuoteValidationException extends RuntimeException {
    private final String reason;

    public QuoteValidationException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
```

- [ ] **Step 2: 实现目标校验和快照生成**

新增 `QuoteService`，公开唯一入口：

```java
public Map<String, Object> enrich(
        String cid,
        String type,
        Map<String, Object> body
)
```

实现必须满足：

```java
if (!"TEXT".equals(type) || body == null || !body.containsKey("quote")) {
    return body;
}
Object rawQuote = body.get("quote");
if (!(rawQuote instanceof Map<?, ?> quote)) {
    throw new QuoteValidationException("QUOTE_TARGET_INVALID");
}
long targetSeq = positiveLong(quote.get("targetSeq"));
ImMessage target = repo.findByCidAndSeq(cid, targetSeq)
        .orElseThrow(() -> new QuoteValidationException("QUOTE_TARGET_NOT_FOUND"));
if (target.isRecalled()) {
    throw new QuoteValidationException("QUOTE_TARGET_RECALLED");
}
if (!SUPPORTED_TYPES.contains(target.getType()) || target.getSenderId() == null) {
    throw new QuoteValidationException("QUOTE_TARGET_UNSUPPORTED");
}
```

`positiveLong` 使用 `new BigDecimal(number.toString()).longValueExact()`，拒绝小数、溢出、零和负数。快照使用 `LinkedHashMap` 固定字段顺序；正文先复制再覆盖客户端字段：

```java
Map<String, String> names = conversationService.displayNames(List.of(target.getSenderId()));
String senderName = normalizeText(
        names.getOrDefault(target.getSenderId(), "用户 #" + target.getSenderId()),
        80,
        "用户 #" + target.getSenderId()
);
Map<String, Object> snapshot = new LinkedHashMap<>();
snapshot.put("targetSeq", targetSeq);
snapshot.put("senderId", target.getSenderId());
snapshot.put("senderName", senderName);
snapshot.put("type", target.getType());
snapshot.put("summary", summaryOf(target));
Map<String, Object> enriched = new LinkedHashMap<>(body);
enriched.put("quote", snapshot);
return enriched;
```

`summaryOf` 只读取目标本身：`TEXT` 读取 `body.text` 并以 `[文本]` 兜底，`IMAGE` 返回 `[图片]`，`AUDIO` 返回 `[语音]`，`FILE` 对 `body.filename` 将反斜杠转为 `/` 后取 basename 并以 `[文件]` 兜底。`normalizeText` 删除 `\p{C}` 控制字符、将连续空白折叠为一个空格，再按 Unicode 码点截断。

- [ ] **Step 3: 接入 SEND 前置链路**

给 `InboundMessageConsumer` 构造器注入 `QuoteService`。在媒体校验之后、`mentionService.resolve(...)` 之前加入：

```java
try {
    env.setBody(quoteService.enrich(env.getCid(), env.getType(), env.getBody()));
} catch (QuoteValidationException ex) {
    pushError(env, ex.getReason());
    return;
}
```

后续提及校验、`MessageAppender.append` 和链接卡片异步补写都必须使用覆盖后的 `env.getBody()`。普通文本和所有非 `TEXT` 类型保持原行为。

- [ ] **Step 4: 做服务端静态验证**

Run:

```bash
mvn -f backend/pom.xml -Dmaven.test.skip=true package
git diff --check -- backend/src/main/java/com/rbac/im/service/QuoteValidationException.java backend/src/main/java/com/rbac/im/service/QuoteService.java backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java
```

Expected: Maven 退出码为 0；差异检查无输出。不要运行 JUnit。

- [ ] **Step 5: 查看差异并提交服务端引用校验**

```bash
git diff -- backend/src/main/java/com/rbac/im/service/QuoteValidationException.java backend/src/main/java/com/rbac/im/service/QuoteService.java backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java
git add backend/src/main/java/com/rbac/im/service/QuoteValidationException.java backend/src/main/java/com/rbac/im/service/QuoteService.java backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java
git commit -m "功能(IM后端)：生成消息引用快照"
```

提交中不得包含 `ImConversationMember.java` 或 `ConversationService.java`。

---

### Task 2: SDK Core 构建和合法化引用载荷

**Files:**
- Create: `im-client/packages/im-sdk-core/src/chat/quotePayload.ts`
- Modify: `im-client/packages/im-sdk-core/src/chat/mentionPayload.ts`
- Modify: `im-client/packages/im-sdk-core/src/chat/linkCard.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`

**Interfaces:**
- Consumes: `ChatMessage`、`SendTextOptions`、现有 `normalizeTextMessageBody`。
- Produces: `MessageQuote`、`normalizeMessageQuote(value)`、`buildMessageQuote(message, senderName)`、`canQuoteMessage(message)`，以及 `SendTextOptions.quote?: MessageQuote`。

- [ ] **Step 1: 定义引用类型与安全合法化**

创建 `quotePayload.ts`：

```ts
import type { ChatMessage } from '../store/outboxStore';

export type QuotedMessageType = 'TEXT' | 'IMAGE' | 'FILE' | 'AUDIO';

export interface MessageQuote {
  targetSeq: number;
  senderId: number;
  senderName: string;
  type: QuotedMessageType;
  summary: string;
}

export function normalizeMessageQuote(value: unknown): MessageQuote | null;
export function canQuoteMessage(message: ChatMessage): boolean;
export function buildMessageQuote(
  message: ChatMessage,
  senderName: string,
): MessageQuote | null;
```

`normalizeMessageQuote` 要求对象非数组、`targetSeq` 和 `senderId` 为正安全整数、类型在四类集合内、姓名和摘要为非空字符串。文本先移除 `\p{C}`、折叠空白，再用 `Array.from(text).slice(0, limit).join('')` 分别限制 80/120 个 Unicode 码点。

`canQuoteMessage` 要求 `seq != null`、`status === 'sent'`、`recalled === false` 且类型受支持。`buildMessageQuote` 使用目标自身字段生成本地乐观快照；文本空内容为 `[文本]`，图片/语音为固定摘要，文件对 `/` 和 `\\` 均取 basename 后以 `[文件]` 兜底；目标自身的 `body.quote` 不参与摘要。

- [ ] **Step 2: 把引用并入文本发送选项**

在 `mentionPayload.ts` 中扩展接口：

```ts
import { normalizeMessageQuote, type MessageQuote } from './quotePayload';

export interface SendTextOptions {
  mentions?: readonly number[];
  mentionAll?: boolean;
  mentionRanges?: readonly TextMentionRange[];
  quote?: MessageQuote;
}
```

移除当前“无提及时提前返回 `{ text }`”的分支，始终先创建 `body`，合法引用存在时加入：

```ts
const body: Record<string, unknown> = { text };
const quote = normalizeMessageQuote(options.quote);
if (quote != null) body.quote = quote;
// 保留现有 mentionAll / mentions / mentionRanges 组装逻辑
return body;
```

确保只有引用、只有提及、引用加提及、普通文本四种组合都不会互相覆盖字段。

- [ ] **Step 3: 统一下行文本正文合法化**

修改 `normalizeTextMessageBody`，分别判断原对象是否拥有 `link` 和 `quote`，再重建正文：

```ts
const hasLink = Object.prototype.hasOwnProperty.call(body, 'link');
const hasQuote = Object.prototype.hasOwnProperty.call(body, 'quote');
if (!hasLink && !hasQuote) return body;
const { link: rawLink, quote: rawQuote, ...rest } = body;
const link = hasLink ? normalizeLinkCard(rawLink) : null;
const quote = hasQuote ? normalizeMessageQuote(rawQuote) : null;
return {
  ...rest,
  ...(link == null ? {} : { link }),
  ...(quote == null ? {} : { quote }),
};
```

从 `linkCard.ts` 导入引用合法化函数；无效引用只被移除，`text`、提及字段和合法链接必须保留。

- [ ] **Step 4: 导出公共接口并做 SDK 静态验证**

在 `src/index.ts` 增加：

```ts
export * from './chat/quotePayload';
```

Run:

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
cd ..
git diff --check -- im-client/packages/im-sdk-core/src/chat/quotePayload.ts im-client/packages/im-sdk-core/src/chat/mentionPayload.ts im-client/packages/im-sdk-core/src/chat/linkCard.ts im-client/packages/im-sdk-core/src/index.ts
```

Expected: 两条命令退出码均为 0。不要运行 Vitest 或 Jest。

- [ ] **Step 5: 查看差异并提交 SDK 引用载荷**

```bash
git diff -- im-client/packages/im-sdk-core/src/chat/quotePayload.ts im-client/packages/im-sdk-core/src/chat/mentionPayload.ts im-client/packages/im-sdk-core/src/chat/linkCard.ts im-client/packages/im-sdk-core/src/index.ts
git add im-client/packages/im-sdk-core/src/chat/quotePayload.ts im-client/packages/im-sdk-core/src/chat/mentionPayload.ts im-client/packages/im-sdk-core/src/chat/linkCard.ts im-client/packages/im-sdk-core/src/index.ts
git commit -m "功能(IM客户端)：定义消息引用载荷"
```

---

### Task 3: 移动端引用选择、展示和定位

**Files:**
- Create: `im-client/packages/app-mobile/src/components/MessageQuoteContent.tsx`
- Modify: `im-client/packages/app-mobile/src/components/MessageActionSheet.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: Task 2 的 `MessageQuote`、`normalizeMessageQuote`、`buildMessageQuote`、`canQuoteMessage` 和 `SendTextOptions.quote`。
- Produces: 可复用 `MessageQuoteContent` 组件；聊天页引用草稿、气泡引用块、撤回占位、本地定位和短暂高亮交互。

- [ ] **Step 1: 创建复用引用展示组件**

新增组件接口：

```tsx
interface Props {
  quote: MessageQuote;
  mode: 'composer' | 'message';
  recalled?: boolean;
  onPress?: () => void;
  onClose?: () => void;
}

export function MessageQuoteContent(props: Props): React.JSX.Element;
```

`composer` 模式显示发送者、类型图标、单行摘要和关闭按钮；`message` 模式用 `Pressable` 显示相同内容。`recalled === true` 时只显示“原消息已撤回”，不渲染发送者/摘要，不绑定 `onPress`。类型图标固定映射：文本 `chatbox-outline`、图片 `image-outline`、文件 `document-outline`、语音 `mic-outline`。使用现有 `COLORS`、`RADIUS`、`SPACING`、`TYPE`，并提供中文无障碍标签。

- [ ] **Step 2: 扩展消息操作面板**

将 `MessageActionSheet` Props 改为：

```ts
interface Props {
  visible: boolean;
  canQuote: boolean;
  canRecall: boolean;
  onClose: () => void;
  onQuote: () => void;
  onRecall: () => void;
}
```

`canQuote` 时显示主色“引用”，`canRecall` 时显示危险色“撤回”；两者均为 false 时聊天页不得打开面板。保留关闭遮罩、底部安全留白和现有无障碍行为。

- [ ] **Step 3: 增加聊天页引用状态和发送合并**

在 `ChatScreen` 增加：

```ts
const [quoteDraft, setQuoteDraft] = useState<MessageQuote | null>(null);
const [highlightedSeq, setHighlightedSeq] = useState<number | null>(null);
const listRef = useRef<FlatList<ChatMessage>>(null);
const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

会话 `cid` 变化和组件卸载时清空引用、高亮与定时器。发送文本时合并选项，并且只在 `sdk.chat.sendText` 成功写入 outbox 后清空文字、提及范围和引用：

```ts
const options = { ...toSendTextOptions(draft), quote: quoteDraft ?? undefined };
await sdk.chat.sendText(cid, draft.text, options);
setDraft(emptyMentionDraft());
setQuoteDraft(null);
```

附件选择、媒体入队、录音模式切换和语音发送不得修改 `quoteDraft`。

- [ ] **Step 4: 接入长按选择和输入区预览**

长按入口条件改为：

```ts
const quotable = canQuoteMessage(item);
const recallable = canRecallMessage(item, myId, conversationType, myGroupRole);
const actionable = quotable || recallable;
```

对可操作消息保存 `selectedMessage`。点击“引用”时，用聊天页已有名称规则解析目标发送者，调用 `buildMessageQuote(selectedMessage, senderName)`，成功后写入 `quoteDraft` 并关闭面板；失败时提示“这条消息当前不能引用”。

在 composer 行上方渲染：

```tsx
{quoteDraft == null ? null : (
  <MessageQuoteContent
    quote={quoteDraft}
    mode="composer"
    onClose={() => setQuoteDraft(null)}
  />
)}
```

关闭引用不得调用 `setDraft`。

- [ ] **Step 5: 展示气泡引用和撤回占位**

对每条 `TEXT` 消息调用 `normalizeMessageQuote(item.body?.quote)`。在 `MentionText` 之前渲染引用块；通过现有 `recallOperators.has(quote.targetSeq)` 判断目标是否已撤回：

```tsx
{quote == null ? null : (
  <MessageQuoteContent
    quote={quote}
    mode="message"
    recalled={recallOperators.has(quote.targetSeq)}
    onPress={() => locateQuotedMessage(quote.targetSeq)}
  />
)}
<MentionText body={item.body} />
```

引用回复自身被撤回时仍走现有整条气泡隐藏分支。链接卡片继续位于正文之后。

- [ ] **Step 6: 实现本地定位和短暂高亮**

给 `FlatList` 绑定 `ref={listRef}`。定位逻辑在当前倒序 `data` 中按 `seq` 查找：

```ts
const locateQuotedMessage = useCallback((targetSeq: number) => {
  const index = data.findIndex((message) => message.seq === targetSeq);
  if (index < 0) {
    showBanner('原消息暂未加载');
    return;
  }
  listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  setHighlightedSeq(targetSeq);
  if (highlightTimerRef.current != null) clearTimeout(highlightTimerRef.current);
  highlightTimerRef.current = setTimeout(() => {
    highlightTimerRef.current = null;
    if (mountedRef.current) setHighlightedSeq(null);
  }, 1600);
}, [data, showBanner]);
```

`onScrollToIndexFailed` 显示同一提示。气泡 `item.seq === highlightedSeq` 时增加主色描边；不得改变消息气泡原本的己方/对端背景色。

- [ ] **Step 7: 映射引用错误并做移动端静态验证**

在 `sendErrorText` 中增加四个中文映射：目标格式错误、目标不存在、目标已撤回、目标类型不支持。然后运行：

```bash
cd im-client
npx tsc -p packages/app-mobile --noEmit
npx eslint packages/app-mobile/src/components/MessageQuoteContent.tsx packages/app-mobile/src/components/MessageActionSheet.tsx packages/app-mobile/src/screens/ChatScreen.tsx
cd ..
git diff --check -- im-client/packages/app-mobile/src/components/MessageQuoteContent.tsx im-client/packages/app-mobile/src/components/MessageActionSheet.tsx im-client/packages/app-mobile/src/screens/ChatScreen.tsx
```

Expected: TypeScript 与改动文件 ESLint 退出码为 0，差异检查无输出。不要运行 Jest 或启动模拟器代替用户手测。

- [ ] **Step 8: 查看差异并提交移动端交互**

```bash
git diff -- im-client/packages/app-mobile/src/components/MessageQuoteContent.tsx im-client/packages/app-mobile/src/components/MessageActionSheet.tsx im-client/packages/app-mobile/src/screens/ChatScreen.tsx
git add im-client/packages/app-mobile/src/components/MessageQuoteContent.tsx im-client/packages/app-mobile/src/components/MessageActionSheet.tsx im-client/packages/app-mobile/src/screens/ChatScreen.tsx
git commit -m "功能(IM客户端)：支持引用消息"
```

---

### Task 4: 更新交接记录并完成静态收口

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`

**Interfaces:**
- Consumes: Tasks 1–3 的服务端、SDK 和移动端交付结果。
- Produces: 下一窗口可直接继续的实现状态、提交清单和用户手测清单。

- [ ] **Step 1: 更新实现状态和关键文件**

在交接文档中记录：消息引用代码已完成、等待用户手动验收；补充 `QuoteService.java`、`quotePayload.ts`、`MessageQuoteContent.tsx` 的职责；把本轮三个实现提交加入关键提交表。不要把消息免打扰或置顶聊天写成已开始。

- [ ] **Step 2: 写入精确手测清单**

加入以下场景：

1. 分别引用文本、图片、文件和语音并发送。
2. 取消引用不清空文字；选择媒体或切换语音模式不消费引用。
3. 点击引用定位并短暂高亮本地原消息；本地缺失时显示提示。
4. 已撤回消息不能新引用；原消息后撤回时既有引用显示撤回占位。
5. 引用回复失败重试后引用不丢且最终只有一条消息。
6. 单聊、群聊、实时接收、离线恢复和页面重进展示一致。
7. 回复正文的提及、链接卡片和引用块互不影响。
8. 畸形/伪造引用字段不能伪造快照，也不阻断合法正文展示。
9. 撤回引用回复后正文、引用块和链接卡片全部隐藏。

- [ ] **Step 3: 运行最终静态检查**

```bash
mvn -f backend/pom.xml -Dmaven.test.skip=true package
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
cd ..
git diff --check
git status --short
```

Expected: Maven 和两项 TypeScript 检查退出码为 0；`git diff --check` 无输出；状态中只剩交接文档和用户原有两处后端注释改动。不要运行任何自动化测试。

- [ ] **Step 4: 审核并提交交接文档**

```bash
git diff -- docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md
git add docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md
git commit -m "文档(IM客户端)：记录消息引用开发状态"
git status --short
```

最终状态只能保留用户自己的 `ImConversationMember.java` 与 `ConversationService.java` 改动。不要 push。
