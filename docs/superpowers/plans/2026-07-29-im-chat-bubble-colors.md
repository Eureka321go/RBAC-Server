# IM 聊天气泡颜色调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将聊天气泡统一为白底黑字，并用浅蓝色文字展示合法的 `@` 提及片段。

**Architecture:** 在主题中增加单一提及文字色，消息文本组件统一消费正文色和提及色；聊天页只负责统一气泡背景，不改消息行为或提及解析。

**Tech Stack:** React Native 0.86、React 19、TypeScript 5.8。

## Global Constraints

- 不新增依赖。
- 不改变消息发送、提及解析、长按操作和状态展示。
- 不新增或运行自动化测试；只执行 TypeScript 和差异检查，由用户完成视觉验收。
- 只创建本地中文提交，不主动 push。

---

### Task 1: 统一气泡与提及颜色

**Files:**
- Modify: `im-client/packages/app-mobile/src/ui/theme.ts`
- Modify: `im-client/packages/app-mobile/src/components/MentionText.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Produces: `COLORS.mention`，固定为浅蓝色 `#5B8DEF`。
- Preserves: `MentionText` 的消息正文解析与安全降级行为。

- [ ] **Step 1: 增加主题色**

在 `COLORS` 中增加：

```ts
mention: '#5B8DEF',
```

- [ ] **Step 2: 统一消息文字样式**

将 `MentionText` 的普通正文统一为 `COLORS.text`，提及片段统一为 `COLORS.mention`，移除提及背景色和不再需要的己方/对端颜色分支。组件调用改为：

```tsx
<MentionText body={item.body} />
```

- [ ] **Step 3: 统一气泡背景**

将 `ChatScreen` 的 `bubbleMine` 背景改为 `COLORS.surface`；对端气泡继续使用 `COLORS.surface` 和现有细边框。

- [ ] **Step 4: 执行静态检查**

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
git diff --check
```

预期：全部退出码为 0；不运行自动化或视觉测试。

- [ ] **Step 5: 本地中文提交**

```bash
git add packages/app-mobile/src/ui/theme.ts packages/app-mobile/src/components/MentionText.tsx packages/app-mobile/src/screens/ChatScreen.tsx
git commit -m "样式(IM客户端)：统一聊天气泡与提及颜色"
```
