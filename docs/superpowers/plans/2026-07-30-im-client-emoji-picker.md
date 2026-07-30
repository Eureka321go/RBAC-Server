# IM 常用 Emoji 面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在聊天输入框内增加紧凑的 Emoji 入口和应用内常用表情面板，支持光标插入、选区替换与完整 Unicode 字素退格。

**Architecture:** 把 Unicode 文本编辑放进无 UI 依赖的 `emojiTextEditing` 纯函数模块，把固定表情宫格放进独立 `EmojiPicker` 组件，由 `ChatScreen` 统一管理面板、键盘、语音模式和草稿选择范围。Emoji 继续作为普通 TEXT 正文发送，不修改 SDK、服务端或数据库。

**Tech Stack:** React Native 0.86、React 19、TypeScript、现有 Ionicons 与主题 token。

## Global Constraints

- 不增加 npm 依赖，不修改消息协议、SDK、服务端或数据库。
- 输入框内笑脸按钮视觉尺寸为 36×36，点击热区至少 44×44。
- 面板位于输入栏下方、底部安全区上方，高度 240dp，8 列，每个单元格至少 44×44。
- 约 80 个本地常用 Emoji；不实现分类、搜索、肤色选择、最近使用、自定义表情或贴纸。
- 插入和退格必须继续经过 `applyMentionTextChange`，引用草稿保持不变。
- 按用户约定不新增或运行 Jest、E2E 等自动化测试；仅做 TypeScript、相关 ESLint、`git diff --check` 与手动验收。
- 只提交本计划涉及的文件，保留工作区中其他未提交改动。

---

## File Map

- Create: `im-client/packages/app-mobile/src/emoji/emojiTextEditing.ts` — 选择范围归一化、文本插入和前一 Unicode 字素边界。
- Create: `im-client/packages/app-mobile/src/components/EmojiPicker.tsx` — 常用 Emoji 宫格与退格按钮。
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx` — 输入框内入口、键盘/面板互斥、草稿接线与生命周期清理。
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md` — 记录功能、提交与手动验收项。

### Task 1: Unicode-safe text editing helpers

**Files:**
- Create: `im-client/packages/app-mobile/src/emoji/emojiTextEditing.ts`

**Interfaces:**
- Consumes: `text: string` and `{ start: number; end: number }` from the controlled `TextInput`.
- Produces: `replaceSelection(text, selection, replacement): TextEditResult` and `deleteBackward(text, selection): TextEditResult`.

- [ ] **Step 1: Define stable edit types and normalize selections**

```ts
export interface TextSelection {
  start: number;
  end: number;
}

export interface TextEditResult {
  text: string;
  selection: TextSelection;
}

function normalizeSelection(text: string, selection: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(text.length, Math.min(selection.start, selection.end)));
  const end = Math.max(start, Math.min(text.length, Math.max(selection.start, selection.end)));
  return { start, end };
}
```

- [ ] **Step 2: Implement insertion and selection replacement**

```ts
export function replaceSelection(
  text: string,
  selection: TextSelection,
  replacement: string,
): TextEditResult {
  const range = normalizeSelection(text, selection);
  const cursor = range.start + replacement.length;
  return {
    text: `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`,
    selection: { start: cursor, end: cursor },
  };
}
```

- [ ] **Step 3: Implement previous grapheme discovery**

Use `Intl.Segmenter` when present without assuming its TypeScript lib declaration. The fallback must scan code points without splitting surrogate pairs and must absorb variation selectors, combining marks, skin-tone modifiers, keycap markers, regional-indicator pairs, emoji tag code points and zero-width-joiner chains.

```ts
interface SegmentPart { index: number; segment: string }
interface SegmenterLike { segment(input: string): Iterable<SegmentPart> }
type SegmenterConstructor = new (
  locale?: string,
  options?: { granularity: 'grapheme' },
) => SegmenterLike;

function previousGraphemeStart(text: string, cursor: number): number {
  const prefix = text.slice(0, cursor);
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (Segmenter != null) {
    let lastStart = 0;
    for (const part of new Segmenter(undefined, { granularity: 'grapheme' }).segment(prefix)) {
      lastStart = part.index;
    }
    return lastStart;
  }
  return previousGraphemeStartFallback(text, cursor);
}
```

The fallback uses small helpers named `codePointBefore`, `isGraphemeExtender`, `previousEmojiComponentStart`, and `previousGraphemeStartFallback`; keep all helpers private to this file.

```ts
interface PreviousCodePoint { start: number; value: number }

function codePointBefore(text: string, end: number): PreviousCodePoint | null {
  if (end <= 0) return null;
  let start = end - 1;
  const trailing = text.charCodeAt(start);
  if (trailing >= 0xdc00 && trailing <= 0xdfff && start > 0) {
    const leading = text.charCodeAt(start - 1);
    if (leading >= 0xd800 && leading <= 0xdbff) start -= 1;
  }
  return { start, value: text.codePointAt(start) as number };
}

function isGraphemeExtender(value: number): boolean {
  return value === 0xfe0e || value === 0xfe0f || value === 0x20e3
    || (value >= 0x1f3fb && value <= 0x1f3ff)
    || (value >= 0xe0020 && value <= 0xe007f)
    || (value >= 0x0300 && value <= 0x036f)
    || (value >= 0x1ab0 && value <= 0x1aff)
    || (value >= 0x1dc0 && value <= 0x1dff)
    || (value >= 0x20d0 && value <= 0x20ff)
    || (value >= 0xfe20 && value <= 0xfe2f);
}

function isRegionalIndicator(value: number): boolean {
  return value >= 0x1f1e6 && value <= 0x1f1ff;
}

function previousEmojiComponentStart(text: string, end: number): number {
  let previous = codePointBefore(text, end);
  if (previous == null) return 0;
  let start = previous.start;
  while (isGraphemeExtender(previous.value)) {
    previous = codePointBefore(text, start);
    if (previous == null) return 0;
    start = previous.start;
  }
  if (isRegionalIndicator(previous.value)) {
    const paired = codePointBefore(text, start);
    if (paired != null && isRegionalIndicator(paired.value)) start = paired.start;
  }
  return start;
}

function previousGraphemeStartFallback(text: string, cursor: number): number {
  let start = previousEmojiComponentStart(text, cursor);
  let joiner = codePointBefore(text, start);
  while (joiner?.value === 0x200d) {
    start = previousEmojiComponentStart(text, joiner.start);
    joiner = codePointBefore(text, start);
  }
  return start;
}
```

- [ ] **Step 4: Implement backward deletion**

```ts
export function deleteBackward(text: string, selection: TextSelection): TextEditResult {
  const range = normalizeSelection(text, selection);
  if (range.start !== range.end) return replaceSelection(text, range, '');
  if (range.start === 0) return { text, selection: range };
  return replaceSelection(
    text,
    { start: previousGraphemeStart(text, range.start), end: range.start },
    '',
  );
}
```

- [ ] **Step 5: Run focused static verification**

Run:

```bash
npx tsc --noEmit
npx eslint src/emoji/emojiTextEditing.ts
git diff --check
```

Expected: TypeScript exits 0, the new helper has no ESLint errors, and no whitespace errors are reported.

- [ ] **Step 6: Commit the helper**

```bash
git add im-client/packages/app-mobile/src/emoji/emojiTextEditing.ts
git commit -m "新增(IM客户端)：支持 Emoji 光标编辑"
```

### Task 2: Common Emoji picker component

**Files:**
- Create: `im-client/packages/app-mobile/src/components/EmojiPicker.tsx`

**Interfaces:**
- Consumes: `onSelect(emoji: string): void` and `onDelete(): void` callbacks.
- Produces: a fixed 240dp panel containing an eight-column scrollable grid and one Ionicons backspace control.

- [ ] **Step 1: Define the local list and component contract**

```ts
interface Props {
  onSelect(emoji: string): void;
  onDelete(): void;
}

const COMMON_EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
  '😊', '🙂', '🙃', '😉', '😍', '🥰', '😘', '😋',
  '😎', '🤓', '🧐', '🤔', '🤨', '😐', '😑', '😶',
  '🙄', '😏', '😣', '😥', '😮', '🤐', '😯', '😪',
  '😫', '🥱', '😴', '😌', '🤤', '😒', '😓', '😔',
  '😕', '🙁', '☹️', '😖', '😞', '😟', '😤', '😢',
  '😭', '😦', '😧', '😨', '😩', '🤯', '😬', '😰',
  '😱', '🥵', '🥶', '😳', '🤪', '😵', '🤢', '🤮',
  '👍', '👍🏻', '👎', '👏', '🙏', '💪', '👌', '✌️',
  '🤝', '👨‍👩‍👧‍👦', '❤️', '💔', '💕', '🎉', '🎂', '🔥',
];
```

- [ ] **Step 2: Render an accessible eight-column grid**

Use `FlatList` with `numColumns={8}`, a stable Emoji string key plus index, `keyboardShouldPersistTaps="always"`, and cells that call `onSelect`. Each cell is at least 44×44 and exposes `accessibilityRole="button"` with `accessibilityLabel={`插入表情 ${emoji}`}`.

- [ ] **Step 3: Add the sticky delete control**

Place an existing `IconButton` using `backspace-outline` at the lower right of the panel, label it `删除前一个字符`, and call `onDelete`. Use existing `COLORS`, `SPACING` and border tokens; do not add images, custom SVG or text-symbol icons.

- [ ] **Step 4: Run focused static verification**

Run:

```bash
npx tsc --noEmit
npx eslint src/components/EmojiPicker.tsx
git diff --check
```

Expected: TypeScript exits 0, the new component has no ESLint errors, and no whitespace errors are reported.

- [ ] **Step 5: Commit the picker**

```bash
git add im-client/packages/app-mobile/src/components/EmojiPicker.tsx
git commit -m "新增(IM客户端)：实现常用 Emoji 面板"
```

### Task 3: Integrate the picker with ChatScreen

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: `EmojiPicker`, `replaceSelection`, `deleteBackward`, existing `MentionDraftState`, `applyMentionTextChange`, `draftSelection`, `inputRef` and voice/attachment handlers.
- Produces: keyboard/picker mutually exclusive behavior and a smile button embedded in the text input shell.

- [ ] **Step 1: Add imports and picker state**

Import `Keyboard`, `EmojiPicker`, `replaceSelection`, `deleteBackward`, `TextEditResult`, and `TextSelection`. Add synchronous refs so rapid consecutive taps never reuse an old draft or cursor:

```ts
const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
const draftRef = useRef(draft);
const draftSelectionRef = useRef<TextSelection>(draftSelection);
draftRef.current = draft;
draftSelectionRef.current = draftSelection;
```

Reset it alongside other per-conversation UI state and set it to false during cleanup.

- [ ] **Step 2: Add one draft edit adapter**

```ts
const applyTextEdit = useCallback((edit: (
  text: string,
  selection: TextSelection,
) => TextEditResult) => {
  const current = draftRef.current;
  const result = edit(current.text, draftSelectionRef.current);
  const nextDraft = applyMentionTextChange(current, result.text);
  draftRef.current = nextDraft;
  draftSelectionRef.current = result.selection;
  setDraft(nextDraft);
  setDraftSelection(result.selection);
  setMentionTrigger(null);
  setMentionPickerVisible(false);
}, []);

const insertEmoji = useCallback((emoji: string) => {
  applyTextEdit((text, selection) => replaceSelection(text, selection, emoji));
}, [applyTextEdit]);

const deleteEmojiBackward = useCallback(() => {
  applyTextEdit(deleteBackward);
}, [applyTextEdit]);
```

Whenever normal text input or selection callbacks update state, update the matching ref in the same callback before calling the React setter. Do the same when send, conversation reset or mention insertion replaces the draft/selection. Do not reconstruct mention metadata manually.

- [ ] **Step 3: Add keyboard/picker transitions**

```ts
const toggleEmojiPicker = useCallback(() => {
  if (emojiPickerVisible) {
    setEmojiPickerVisible(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    return;
  }
  setVoiceMode(false);
  inputRef.current?.blur();
  Keyboard.dismiss();
  setEmojiPickerVisible(true);
}, [emojiPickerVisible]);

const openKeyboardFromInput = useCallback(() => {
  if (emojiPickerVisible) setEmojiPickerVisible(false);
}, [emojiPickerVisible]);
```

Also close the panel before switching to voice mode and before opening the attachment picker. After a successful send, close the panel; do not clear it before `sendText` resolves.

- [ ] **Step 4: Wrap the TextInput and embed the smile button**

Replace the standalone `TextInput` with an input shell that owns the existing border, radius and background. Keep the text input `flex: 1`, remove its own border/background, and add `paddingRight` sufficient for a 36dp smile control. Add an `IconButton` using `happy-outline`, label `打开常用表情` or `切换到键盘` according to state, and keep its visual size 36×36.

Bind `onPressIn={openKeyboardFromInput}` to the `TextInput`. Keep controlled `selection`, mention handling and `onSubmitEditing` unchanged.

- [ ] **Step 5: Render the panel below the composer**

Inside the existing bottom `SafeAreaView`, render:

```tsx
{emojiPickerVisible && !voiceMode ? (
  <EmojiPicker onSelect={insertEmoji} onDelete={deleteEmojiBackward} />
) : null}
```

Place it after `styles.composer`, so it appears below the input row and above the bottom safe-area inset.

- [ ] **Step 6: Run static verification**

Run:

```bash
npx tsc --noEmit
npx eslint src/emoji/emojiTextEditing.ts src/components/EmojiPicker.tsx
git diff --check
```

Also run `npx eslint src/screens/ChatScreen.tsx` and record its existing hook/no-void findings separately; the integration must not add new errors relative to the known baseline of 4 hook errors and 19 warnings.

- [ ] **Step 7: Perform the manual acceptance pass**

Verify all eight cases from `docs/superpowers/specs/2026-07-30-im-client-emoji-picker-design.md`, including cursor insertion, selection replacement, mention invalidation, compound Emoji deletion, panel/keyboard switching, voice/attachment closure, send closure, scrolling and both platform layouts.

- [ ] **Step 8: Commit the integration**

```bash
git add im-client/packages/app-mobile/src/screens/ChatScreen.tsx
git commit -m "新增(IM客户端)：接入聊天 Emoji 输入"
```

### Task 4: Update handoff and complete verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`

**Interfaces:**
- Consumes: final commit hashes and actual verification results from Tasks 1–3.
- Produces: current project handoff state and exact manual retest list.

- [ ] **Step 1: Update the handoff**

Add the Emoji design/plan paths, implementation commits, static verification outcome and the eight manual acceptance cases. Preserve unrelated handoff content and existing user-owned backend edits.

- [ ] **Step 2: Run final verification**

Run:

```bash
npx tsc --noEmit
npx eslint src/emoji/emojiTextEditing.ts src/components/EmojiPicker.tsx
git diff --check
git status --short
```

Expected: TypeScript and new-file ESLint exit 0; whitespace check exits 0; status contains only the documented user-owned backend changes plus any handoff change not yet committed.

- [ ] **Step 3: Commit documentation only**

```bash
git add docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md
git commit -m "文档(IM客户端)：交接 Emoji 面板功能"
```

- [ ] **Step 4: Report manual verification boundary**

State clearly that static checks passed but the visual and interaction acceptance pass still requires the user to run the app on iOS/Android, because no simulator or automated UI test was authorized in this task.
