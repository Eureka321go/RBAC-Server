# IM 客户端消息撤回实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 React Native IM 客户端补齐长按消息撤回、实时/离线状态一致、中文错误反馈和撤回占位渲染。

**Architecture:** `ChatService` 负责撤回请求、单会话待确认状态、ERROR/PUSH 关联和超时；`SyncEngine` 在现有 SQLite 事务内保存 RECALL 控制消息并清空目标正文；`ChatScreen` 只从本地消息视图渲染撤回结果，并通过一个独立底部面板发起操作。服务端仍是权限和 120 秒窗口的最终事实源。

**Tech Stack:** TypeScript 5.8、React Native 0.86、React 19、op-sqlite、现有 `@im/sdk-core` 事件与存储抽象。

## 全局约束

- 只实现消息撤回；不混入 @ 提及、富媒体或链接卡片。
- 不修改后端、网关协议、SQLite migration、导航路由和账号隔离逻辑。
- 不新增或运行自动化测试；只执行 TypeScript、平台边界和 Git 差异检查。
- 撤回入口为长按气泡后的底部操作面板，不增加二次确认。
- 客户端预判本人/群管理员权限和 120 秒窗口；服务端校验始终优先。
- 撤回成功以服务端 PUSH 或 REST 同步为准，不乐观清空正文。
- Git 提交标题和开发记录使用中文；只提交本地 `feat/im`，不主动 push。

---

### Task 1：本地撤回协调与会话摘要

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/store/messageStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`

**Interfaces:**
- Produces: `MessageStore.markMessageRecalled(cid: string, targetSeq: number): Promise<void>`
- Produces: `MessageStore.findRecallOperatorId(cid: string, targetSeq: number): Promise<number | null>`
- Consumes: 已有 `StoredMessage.recalled`、`previewOf('RECALL')` 和 `SyncEngine.applyStored`

- [ ] **Step 1：在 MessageStore 增加聚焦的撤回方法**

新增方法，正文清空与撤回标记必须由一条 UPDATE 完成：

```ts
async markMessageRecalled(cid: string, targetSeq: number): Promise<void> {
  await this.db.exec(
    `UPDATE messages SET recalled = 1, body_json = NULL WHERE cid = ? AND seq = ?`,
    [cid, targetSeq],
  );
}

async findRecallOperatorId(cid: string, targetSeq: number): Promise<number | null> {
  const rows = await this.db.query<Row>(
    `SELECT sender_id, body_json FROM messages
      WHERE cid = ? AND type = 'RECALL' ORDER BY seq DESC`,
    [cid],
  );
  for (const row of rows) {
    if (row.body_json == null) continue;
    try {
      const body = JSON.parse(row.body_json as string) as Record<string, unknown>;
      if (body.targetSeq === targetSeq) {
        return (row.sender_id as number | null) ?? null;
      }
    } catch {
      // 单条损坏控制消息不阻断后续同步。
    }
  }
  return null;
}
```

解析单条损坏的 `body_json` 时跳过该行，不允许脏控制消息阻断同步队列。

- [ ] **Step 2：让 SyncEngine 在同一事务内协调控制消息和目标消息**

在 `applyStored` 中先 upsert，再执行以下分支：

```ts
const targetSeq = stored.type === 'RECALL' && typeof stored.body?.targetSeq === 'number'
  ? stored.body.targetSeq
  : null;

if (targetSeq != null && Number.isSafeInteger(targetSeq) && targetSeq > 0) {
  await messages.markMessageRecalled(cid, targetSeq);
} else if (stored.type !== 'RECALL' && !stored.recalled) {
  const operatorId = await messages.findRecallOperatorId(cid, stored.seq);
  if (operatorId != null) await messages.markMessageRecalled(cid, stored.seq);
}
```

RECALL 控制消息仍写入 messages、推进 conversation/syncedSeq；无效 `targetSeq` 只作为普通控制消息保存，不修改其他消息。

- [ ] **Step 3：保护 REST 的 recalled 状态**

确认 `applyRestMessage` 传入的 `recalled=true` 不会被后续逻辑改回 false；普通消息迟到且已有 RECALL 控制消息时，upsert 后必须再次标记并清正文。

- [ ] **Step 4：执行静态检查**

Run:

```bash
cd im-client
npx --no-install tsc -p packages/im-sdk-core --noEmit
```

Expected: exit 0。

- [ ] **Step 5：中文提交**

```bash
git add im-client/packages/im-sdk-core/src/store/messageStore.ts \
  im-client/packages/im-sdk-core/src/engine/syncEngine.ts
git commit -m "功能(IM客户端)：协调本地消息撤回状态"
```

### Task 2：ChatService 撤回请求、结果与超时

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`
- Modify: `im-client/packages/im-sdk-core/src/chat/chatService.ts`

**Interfaces:**
- Produces: `RecallResultStatus = 'succeeded' | 'failed' | 'timeout'`
- Produces: `SdkEvents.recallResult: { cid: string; targetSeq: number; status: RecallResultStatus; reason?: string }`
- Produces: `ChatService.recall(cid: string, targetSeq: number): Promise<void>`
- Produces: `ChatOptions.recallTimeoutMs?: number`，默认 `10000`
- Consumes: `ConnectionManager.getState()`、`connection.send()`、`OP.RECALL`

- [ ] **Step 1：定义撤回结果事件**

在 `syncEngine.ts` 的事件接口旁新增：

```ts
export type RecallResultStatus = 'succeeded' | 'failed' | 'timeout';

recallResult: {
  cid: string;
  targetSeq: number;
  status: RecallResultStatus;
  reason?: string;
};
```

- [ ] **Step 2：增加单会话待确认状态**

在 ChatService 中增加：

```ts
interface PendingRecall {
  targetSeq: number;
  timer: ReturnType<typeof setTimeout>;
}

private readonly pendingRecalls = new Map<string, PendingRecall>();
private readonly recallTimeoutMs: number;
```

构造时读取 `opts.recallTimeoutMs ?? 10000`；`stop()` 清除所有 timer 和 map。

- [ ] **Step 3：实现 recall 请求**

```ts
async recall(cid: string, targetSeq: number): Promise<void> {
  if (cid === '' || !Number.isSafeInteger(targetSeq) || targetSeq <= 0) {
    throw new Error('INVALID_RECALL_TARGET');
  }
  if (this.connection.getState() !== 'connected') throw new Error('OFFLINE');
  if (this.pendingRecalls.has(cid)) throw new Error('RECALL_PENDING');

  const timer = setTimeout(() => this.enqueue(async () => {
    const pending = this.pendingRecalls.get(cid);
    if (pending?.targetSeq !== targetSeq) return;
    this.pendingRecalls.delete(cid);
    this.emitter.emit('recallResult', { cid, targetSeq, status: 'timeout' });
  }), this.recallTimeoutMs);
  this.pendingRecalls.set(cid, { targetSeq, timer });
  this.connection.send({ op: OP.RECALL, cid, body: { targetSeq } });
}
```

若 `connection.send` 同步抛错，必须清 timer/map 后重新抛出。

- [ ] **Step 4：关联 PUSH 成功与无 clientMsgId 的 ERROR**

`onEnvelope` 处理 PUSH 时先 `await engine.applyPush(env)`，再从 `env.type/body.targetSeq` 匹配 pending；成功后清 timer/map 并 emit `succeeded`。

`onError` 保留现有发送失败逻辑；当 `clientMsgId` 缺失且 `env.cid` 命中 pending 时，清理 pending 并 emit：

```ts
this.emitter.emit('recallResult', {
  cid,
  targetSeq: pending.targetSeq,
  status: 'failed',
  reason,
});
```

- [ ] **Step 5：执行 SDK Core TypeScript 检查**

```bash
cd im-client
npx --no-install tsc -p packages/im-sdk-core --noEmit
```

Expected: exit 0。

- [ ] **Step 6：中文提交**

```bash
git add im-client/packages/im-sdk-core/src/engine/syncEngine.ts \
  im-client/packages/im-sdk-core/src/chat/chatService.ts
git commit -m "功能(IM客户端)：接入撤回请求与结果事件"
```

### Task 3：可复用消息操作底部面板

**Files:**
- Create: `im-client/packages/app-mobile/src/components/MessageActionSheet.tsx`

**Interfaces:**
- Produces: `MessageActionSheet({ visible, onClose, onRecall })`
- Consumes: 现有 `Modal`、`Ionicons`、`IconButton` 和 UI tokens

- [ ] **Step 1：创建受控底部面板**

实现如下结构，组件关闭后由聊天气泡旁的 ActivityIndicator 表达处理中状态：

```tsx
interface Props {
  visible: boolean;
  onClose: () => void;
  onRecall: () => void;
}

export function MessageActionSheet({ visible, onClose, onRecall }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭消息操作"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>消息操作</Text>
            <IconButton name="close" accessibilityLabel="关闭" onPress={onClose} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="撤回消息"
            onPress={onRecall}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <View style={styles.actionIcon}>
              <Ionicons name="arrow-undo-outline" size={21} color={COLORS.danger} />
            </View>
            <Text style={styles.actionText}>撤回</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
```

样式值固定为：overlay `flex:1 / justifyContent:'flex-end' / backgroundColor:COLORS.overlay`；sheet 使用白底、顶部 22 圆角、左右 `SPACING.md`、底部 `SPACING.xxl`；header 最小高度 52；action 最小高度 58。

- [ ] **Step 2：补齐可访问性和安全区**

- Modal `onRequestClose` 调用 `onClose`。
- 操作行使用 `accessibilityRole="button"`、`accessibilityLabel="撤回消息"`。
- 底部 padding 使用 `SPACING.xxl`，保证 Android/iOS 底部安全区域可点。
- 点击遮罩关闭；点击面板内容不得穿透到遮罩。

- [ ] **Step 3：执行 App TypeScript 检查**

```bash
cd im-client
npx --no-install tsc -p packages/app-mobile --noEmit
```

Expected: exit 0。

- [ ] **Step 4：中文提交**

```bash
git add im-client/packages/app-mobile/src/components/MessageActionSheet.tsx
git commit -m "功能(IM客户端)：新增消息操作面板"
```

### Task 4：聊天页撤回交互与占位渲染

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: `sdk.chat.recall`、`SdkEvents.recallResult`、`MessageActionSheet`
- Produces: 长按入口、权限预判、撤回处理中状态、控制消息过滤和中文撤回占位

- [ ] **Step 1：保存群角色和撤回 UI 状态**

增加：

```ts
const [myGroupRole, setMyGroupRole] = useState<'OWNER' | 'ADMIN' | 'MEMBER' | null>(null);
const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
const [recallingSeq, setRecallingSeq] = useState<number | null>(null);
```

群资料并行加载成功后使用 `group?.myRole ?? null`；切换到单聊或新 cid 时清理角色、选中消息和处理中 seq。

- [ ] **Step 2：实现纯计算辅助函数**

在 ChatScreen 文件顶部增加：

```ts
const RECALL_WINDOW_MS = 120_000;

type ConversationType = 'SINGLE' | 'GROUP';
type RecallRole = 'OWNER' | 'ADMIN' | 'MEMBER' | null;

function targetSeqOf(message: ChatMessage): number | null {
  const value = message.body?.targetSeq;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function canRecallMessage(
  message: ChatMessage,
  myId: number | null,
  conversationType: ConversationType,
  myGroupRole: RecallRole,
  now = Date.now(),
): boolean {
  if (myId == null || message.seq == null || message.status !== 'sent') return false;
  if (message.recalled || message.type === 'SYSTEM' || message.type === 'RECALL') return false;
  if (!Number.isFinite(message.ts) || message.ts <= 0) return false;
  const timestamp = message.ts < 10_000_000_000 ? message.ts * 1000 : message.ts;
  if (now - timestamp > RECALL_WINDOW_MS) return false;
  if (message.senderId === myId) return true;
  return conversationType === 'GROUP'
    && (myGroupRole === 'OWNER' || myGroupRole === 'ADMIN');
}

function recallErrorText(reason?: string): string {
  switch (reason) {
    case 'RECALL_WINDOW_EXPIRED': return '消息已超过可撤回时间';
    case 'RECALL_NO_PERMISSION': return '你没有权限撤回这条消息';
    case 'RECALL_TARGET_NOT_FOUND': return '消息不存在或已被处理';
    case 'NOT_RECALLABLE': return '这条消息不能撤回';
    case 'NOT_MEMBER': return '你已不在当前会话中';
    case 'OFFLINE': return '当前离线，连接恢复后重试';
    case 'RECALL_PENDING': return '正在撤回上一条消息，请稍候';
    default: return '撤回失败，请稍后重试';
  }
}
```

时间戳按服务端毫秒时间处理；`ts <= 0` 时不展示入口。只允许 `seq != null`、`status === 'sent'`、未撤回、非 SYSTEM/RECALL 的消息。

- [ ] **Step 3：构建可见消息与撤回操作者映射**

从完整 `items` 提取所有 RECALL 控制消息：

```ts
const recallOperators = new Map<number, number | null>();
const visibleItems = items.filter((item) => {
  if (item.type !== 'RECALL') return true;
  const targetSeq = targetSeqOf(item);
  if (targetSeq != null) recallOperators.set(targetSeq, item.senderId);
  return false;
});
```

对 `visibleItems` 反转后交给 FlatList。`item.recalled` 时在原位置渲染居中占位，不渲染正文、头像、已读、失败或重试状态。

- [ ] **Step 4：接入长按和操作面板**

用 Pressable 包住普通消息气泡；只有 `canRecallMessage(item, myId, conversationType, myGroupRole)` 为真时设置 `onLongPress={() => setSelectedMessage(item)}`。页面底部渲染：

```tsx
<MessageActionSheet
  visible={selectedMessage != null}
  onClose={() => setSelectedMessage(null)}
  onRecall={() => void recallSelected()}
/>
```

`recallSelected` 先保存 seq、关闭面板，再调用 SDK；OFFLINE、RECALL_PENDING 和参数异常转换成中文 banner：

```ts
const recallSelected = useCallback(async () => {
  const message = selectedMessage;
  if (message?.seq == null) return;
  const targetSeq = message.seq;
  setSelectedMessage(null);
  setRecallingSeq(targetSeq);
  try {
    await sdk.chat.recall(cid, targetSeq);
  } catch (cause) {
    setRecallingSeq(null);
    showBanner(recallErrorText(cause instanceof Error ? cause.message : undefined));
  }
}, [cid, selectedMessage, showBanner]);
```

等待期间在目标消息旁显示小型 ActivityIndicator，但不隐藏原正文。

- [ ] **Step 5：订阅撤回结果**

在现有 effect 中通过 `sdk.chat.on` 订阅 `recallResult` 事件：

- cid 不匹配则忽略。
- succeeded：清 `recallingSeq` 并 `safeReload()`。
- failed：清状态并通过 `recallErrorText(reason)` 显示 banner。
- timeout：清状态，执行 `sdk.sync.syncConversation(cid)` 后 `safeReload()`；无论同步是否成功都显示“撤回结果确认超时，已刷新会话”或同步失败详情。
- cleanup 必须调用 offRecall。

- [ ] **Step 6：执行 App TypeScript 检查**

```bash
cd im-client
npx --no-install tsc -p packages/app-mobile --noEmit
```

Expected: exit 0。

- [ ] **Step 7：中文提交**

```bash
git add im-client/packages/app-mobile/src/screens/ChatScreen.tsx
git commit -m "功能(IM客户端)：支持长按撤回消息"
```

### Task 5：静态验证、交接记录与手测清单

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-recall.md`
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`

**Interfaces:**
- Consumes: Tasks 1–4 的完整实现
- Produces: 可复现的静态验证证据和用户手测清单

- [ ] **Step 1：执行最终静态验证**

```bash
cd im-client
npx --no-install tsc -p packages/im-sdk-core --noEmit
npx --no-install tsc -p packages/app-mobile --noEmit
rg -n "from ['\"](react-native|react-native-[^'\"]*|@react-native[^'\"]*)['\"]" packages/im-sdk-core/src
cd ..
git diff --check
```

Expected: 两个 tsc exit 0；平台扫描无匹配（rg exit 1）；`git diff --check` exit 0。

- [ ] **Step 2：审阅最终差异**

```bash
git status --short
git diff --stat HEAD~4..HEAD
git log -5 --oneline
```

确认只包含撤回 SDK、撤回 UI、计划和交接文档，没有后端、migration、导航或无关文件。

- [ ] **Step 3：更新交接文档**

记录：

- 独立 deviceId、已读回执和消息撤回均已实现。
- 下一功能为 @ 提及。
- 用户需要手测设计文档列出的十个撤回场景。
- 保留“不新增或代跑自动化测试、中文提交、不主动 push”的约定。

- [ ] **Step 4：标记本计划完成并中文提交**

```bash
git add docs/superpowers/plans/2026-07-29-im-client-recall.md \
  docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md
git commit -m "文档(IM客户端)：记录消息撤回开发完成"
```

- [ ] **Step 5：向用户报告手测项**

只报告静态验证的真实结果，不声称已完成人工验证；列出单聊本人、单聊他人、群成员本人、群管理员他人、普通成员他人、超时、双设备、离线重连、重复/断线/拒绝、会话摘要十项。
