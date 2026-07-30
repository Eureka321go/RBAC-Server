# IM Client UI and Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved light/dark redesign, restrained motion system, and `聊天｜通讯录｜我的` authenticated tab shell without changing IM business behavior.

**Architecture:** Keep the native stack as the owner of login and secondary screens, and place a typed bottom-tab navigator at its authenticated root. Add a semantic theme provider backed by system appearance and AsyncStorage, then migrate shared primitives before screens. Use React Native `Animated` and `LayoutAnimation` behind reduced-motion-aware helpers; keep SDK subscriptions and mutations in their current screens.

**Tech Stack:** React Native 0.86, React 19, TypeScript 5.8, React Navigation 7, Zustand 5, Jest 29, `@react-native-async-storage/async-storage`, `@react-navigation/bottom-tabs`, `react-native-linear-gradient`.

## Global Constraints

- Preserve authentication, SDK synchronization, message sending, voice, attachment, mention, emoji, and group-management behavior.
- Root tabs are exactly `聊天`, `通讯录`, and `我的`; secondary screens hide the tab bar.
- Appearance choices are exactly `跟随系统`, `浅色`, and `深色`, defaulting to `跟随系统`.
- Light mode uses Aurora Cloud; dark mode uses Night Navigation Neon.
- Motion uses React Native `Animated` and `LayoutAnimation`; do not add Reanimated, Skia, utility CSS, or another state library.
- Interactive targets remain at least 44 by 44 points and reduced-motion settings are respected.
- New theme, navigation, preference, and motion logic maintains at least 80% statement coverage.
- Unsupported settings are omitted instead of rendering dead rows.
- Do not modify server APIs, SDK contracts, message schema, authentication policy, media storage, notification infrastructure, or group permissions.

## File Map

- `src/ui/theme.ts`: semantic light and dark palettes and stable theme types.
- `src/ui/themePreference.ts`: validate, load, and persist appearance preference.
- `src/ui/ThemeProvider.tsx`: resolve saved preference and system scheme.
- `src/ui/motion.ts`: reduced-motion duration and loop policy.
- `src/components/AnimatedEntrance.tsx`, `PressableScale.tsx`, `PresenceDot.tsx`: reusable motion primitives.
- `src/navigation/RootTabs.tsx`: authenticated tab navigator.
- `src/navigation/types.ts`: typed root-stack, tab, and composite screen props.
- `src/screens/ProfileScreen.tsx`: identity, presence, appearance, and logout.
- Existing screens and components: consume dynamic theme while keeping current data flow.
- `__tests__/theme.test.ts`, `themePreference.test.ts`, `motion.test.ts`, `RootTabs.test.tsx`, `ProfileScreen.test.tsx`: new state and navigation coverage.

---

### Task 0: Restore the Existing Test and Lint Baseline

**Files:**
- Modify: `package.json`
- Modify: `../../package-lock.json`
- Modify: `jest.config.js`
- Modify: `src/screens/ChatScreen.tsx`
- Modify: `__tests__/App.test.tsx`

**Interfaces:**
- Produces: a resolvable React Native 0.86 Jest preset and stable voice callback dependencies.

- [x] **Step 1: Reproduce the Jest and lint failures**

```bash
npm test -- --runInBand
npm run lint -- --quiet
```

Expected before the fix: missing `@react-native/jest-preset` and four exhaustive-deps errors for voice recording callbacks.

- [x] **Step 2: Install the matching Jest preset**

```bash
npm install --workspace app-mobile --save-dev @react-native/jest-preset@0.86.0
```

- [x] **Step 3: Isolate the App smoke test and alias stable voice callbacks**

Allow Babel to transform the ESM packages published by React Navigation 7:

```js
transformIgnorePatterns: [
  'node_modules/(?!((jest-)?react-native(-.*)?|@react-native(-community)?|@react-navigation)/)',
],
```

Then alias stable voice callbacks:

```ts
const voiceRecording = useVoiceRecording(options);
const cancelVoiceRecording = voiceRecording.cancel;
const ensureVoicePermission = voiceRecording.ensurePermission;
```

Use the aliases inside the four affected callbacks and dependency arrays. Do not depend on the complete `voiceRecording` result object because the hook returns a new object each render.

Mock the SDK-backed store, screens, safe-area provider, and navigation containers in `App.test.tsx` so this routing smoke test does not initialize Keychain, SQLite, or message transports.

- [x] **Step 4: Verify and commit**

```bash
npm test -- --runInBand
npm run lint -- --quiet
npx tsc --noEmit
git add im-client/package-lock.json im-client/packages/app-mobile/package.json im-client/packages/app-mobile/jest.config.js im-client/packages/app-mobile/src/screens/ChatScreen.tsx im-client/packages/app-mobile/__tests__/App.test.tsx im-client/packages/app-mobile/docs/superpowers/plans/2026-07-30-im-client-ui-motion.md
git commit -m "修复(IM客户端): 恢复测试与静态检查基线"
```

Expected: Jest, lint, and TypeScript all exit 0.

### Task 1: Install the Three Approved UI Dependencies

**Files:**
- Modify: `package.json`
- Modify: `../../package-lock.json`

**Interfaces:**
- Consumes: npm workspace `app-mobile`.
- Produces: bottom tabs, AsyncStorage, and native linear gradient imports.

- [ ] **Step 1: Verify the dependencies are absent**

```bash
npm ls @react-navigation/bottom-tabs @react-native-async-storage/async-storage react-native-linear-gradient
```

Expected: the packages are not resolved for `app-mobile`.

- [ ] **Step 2: Install the workspace dependencies**

Run from `im-client`:

```bash
npm install --workspace app-mobile @react-navigation/bottom-tabs @react-native-async-storage/async-storage react-native-linear-gradient
```

- [ ] **Step 3: Verify exact resolution**

```bash
npm ls --workspace app-mobile @react-navigation/bottom-tabs @react-native-async-storage/async-storage react-native-linear-gradient
```

Expected: exit 0 and one resolved version per package.

- [ ] **Step 4: Commit**

```bash
git add im-client/package-lock.json im-client/packages/app-mobile/package.json
git commit -m "构建(IM客户端): 添加主题导航视觉依赖"
```

### Task 2: Build the Semantic Theme and Preference Layer

**Files:**
- Modify: `src/ui/theme.ts`
- Create: `src/ui/themePreference.ts`
- Create: `src/ui/ThemeProvider.tsx`
- Create: `__tests__/theme.test.ts`
- Create: `__tests__/themePreference.test.ts`

**Interfaces:**
- Produces: `ThemeMode`, `AppTheme`, `LIGHT_THEME`, `DARK_THEME`, `loadThemeMode`, `saveThemeMode`, `ThemeProvider`, and `useAppTheme`.
- Consumers: every component and screen in later tasks.

- [ ] **Step 1: Write failing palette and preference tests**

```ts
test('palettes expose readable semantic roles', () => {
  expect(LIGHT_THEME.isDark).toBe(false);
  expect(DARK_THEME.isDark).toBe(true);
  expect(LIGHT_THEME.colors.page).not.toBe(DARK_THEME.colors.page);
  expect(DARK_THEME.colors.text).not.toBe(DARK_THEME.colors.page);
});

test.each([
  ['system', 'system'], ['light', 'light'], ['dark', 'dark'],
  ['invalid', 'system'], [null, 'system'],
])('normalizes theme mode', (input, expected) => {
  expect(normalizeThemeMode(input)).toBe(expected);
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm test -- --runInBand __tests__/theme.test.ts __tests__/themePreference.test.ts
```

Expected: FAIL because the semantic exports do not exist.

- [ ] **Step 3: Implement stable theme types and palettes**

```ts
export interface ThemeColors {
  page: string; pageAccent: string; surface: string; surfaceElevated: string;
  surfaceMuted: string; text: string; textSecondary: string; textMuted: string;
  border: string; borderStrong: string; primary: string; primaryPressed: string;
  primarySoft: string; primaryGlow: string; success: string; successSoft: string;
  warning: string; warningSoft: string; danger: string; dangerSoft: string;
  messageMine: string; messageOther: string; overlay: string;
  recordingOverlay: string; white: string; tabBar: string; shadow: string;
}

export interface AppTheme {
  isDark: boolean;
  colors: ThemeColors;
  statusBarStyle: 'light-content' | 'dark-content';
}
```

Use `#F3F6FF`, `#FFFFFF`, `#151B2B`, and `#5272EF` as light page, surface, text, and primary. Use `#0A0E1B`, `#151C2D`, `#F2F4FF`, and `#B188FF` for the dark equivalents. Every key above must exist in both palettes.

- [ ] **Step 4: Implement non-blocking preference persistence**

```ts
const THEME_MODE_KEY = '@im/app-mobile/theme-mode';
export type ThemeMode = 'system' | 'light' | 'dark';

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export async function loadThemeMode(): Promise<ThemeMode> {
  try { return normalizeThemeMode(await AsyncStorage.getItem(THEME_MODE_KEY)); }
  catch { return 'system'; }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try { await AsyncStorage.setItem(THEME_MODE_KEY, mode); } catch { return; }
}
```

- [ ] **Step 5: Implement provider resolution**

```tsx
export interface AppThemeContextValue {
  theme: AppTheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => Promise<void>;
  ready: boolean;
}
```

`ThemeProvider` loads once, resolves `dark` when mode is dark or when system mode reports dark, reacts to subsequent system changes, updates state before persistence, and exposes the interface through `useAppTheme`.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- --runInBand __tests__/theme.test.ts __tests__/themePreference.test.ts
git add im-client/packages/app-mobile/src/ui im-client/packages/app-mobile/__tests__/theme.test.ts im-client/packages/app-mobile/__tests__/themePreference.test.ts
git commit -m "新增(IM客户端): 建立明暗主题系统"
```

Expected: tests pass before commit.

### Task 3: Add Reduced-Motion-Aware Animation Primitives

**Files:**
- Create: `src/ui/motion.ts`
- Create: `src/components/AnimatedEntrance.tsx`
- Create: `src/components/PressableScale.tsx`
- Create: `src/components/PresenceDot.tsx`
- Create: `__tests__/motion.test.ts`

**Interfaces:**
- Produces: `resolveMotion`, `AnimatedEntrance`, `PressableScale`, and `PresenceDot`.

- [ ] **Step 1: Write the failing motion policy test**

```ts
test('removes stagger and loops when motion is reduced', () => {
  expect(resolveMotion(true)).toEqual({ enterMs: 0, pressMs: 0, staggerMs: 0, pulse: false });
  expect(resolveMotion(false)).toEqual({ enterMs: 240, pressMs: 120, staggerMs: 30, pulse: true });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --runInBand __tests__/motion.test.ts
```

- [ ] **Step 3: Implement motion policy**

```ts
export function resolveMotion(reduceMotion: boolean) {
  return reduceMotion
    ? { enterMs: 0, pressMs: 0, staggerMs: 0, pulse: false }
    : { enterMs: 240, pressMs: 120, staggerMs: 30, pulse: true };
}
```

`AnimatedEntrance` animates opacity and translateY with the native driver. `PressableScale` animates `1 → 0.97 → 1`, preserves disabled and accessibility props, and enforces a 44-point target. `PresenceDot` loops opacity only when allowed and stops the animation in effect cleanup.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- --runInBand __tests__/motion.test.ts
npx eslint src/ui/motion.ts src/components/AnimatedEntrance.tsx src/components/PressableScale.tsx src/components/PresenceDot.tsx
git add im-client/packages/app-mobile/src/ui/motion.ts im-client/packages/app-mobile/src/components/AnimatedEntrance.tsx im-client/packages/app-mobile/src/components/PressableScale.tsx im-client/packages/app-mobile/src/components/PresenceDot.tsx im-client/packages/app-mobile/__tests__/motion.test.ts
git commit -m "新增(IM客户端): 添加无障碍动效基础组件"
```

Expected: test and lint commands exit 0 before commit.

### Task 4: Migrate Shared UI Primitives to Dynamic Theme

**Files:**
- Modify: `src/components/AppButton.tsx`
- Modify: `src/components/AppTextField.tsx`
- Modify: `src/components/Avatar.tsx`
- Modify: `src/components/CompactScreenHeader.tsx`
- Modify: `src/components/IconButton.tsx`
- Modify: `src/components/StatusNotice.tsx`
- Modify: `src/components/Surface.tsx`
- Modify: `src/components/ConnectionStatusBar.tsx`
- Create: `__tests__/themedPrimitives.test.tsx`

**Interfaces:**
- Consumes: `useAppTheme`, `PressableScale`, `PresenceDot`, and `LinearGradient`.
- Produces: unchanged public props plus light/dark rendering.

- [ ] **Step 1: Write a failing themed render test**

```tsx
async function renderWithTheme(node: React.ReactNode) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

test('renders themed surface and button', async () => {
  const tree = await renderWithTheme(
    <Surface><AppButton label="继续" onPress={jest.fn()} /></Surface>,
  );
  expect(tree.root.findByProps({ accessibilityLabel: '继续' })).toBeTruthy();
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --runInBand __tests__/themedPrimitives.test.tsx
```

- [ ] **Step 3: Convert the eight primitives**

Each calls `useAppTheme` and builds styles from `theme`. The primary button gradient is `['#5272EF', '#7B6AF5']` in light and `['#765CFF', '#A86EFF']` in dark. Avatar uses deterministic two-color pairs. Surface derives background, border, and platform shadow from theme. Connection status uses `PresenceDot` only for connecting and reconnecting. Existing props, roles, labels, and callbacks remain unchanged.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- --runInBand __tests__/themedPrimitives.test.tsx
npx tsc --noEmit
git add im-client/packages/app-mobile/src/components im-client/packages/app-mobile/__tests__/themedPrimitives.test.tsx
git commit -m "重构(IM客户端): 统一主题化基础组件"
```

Expected: test and TypeScript commands exit 0 before commit.

### Task 5: Introduce the Authenticated Bottom-Tab Shell

**Files:**
- Modify: `src/navigation/types.ts`
- Create: `src/navigation/RootTabs.tsx`
- Create: `src/screens/ProfileScreen.tsx`
- Modify: `App.tsx`
- Create: `__tests__/RootTabs.test.tsx`
- Modify: `__tests__/App.test.tsx`

**Interfaces:**
- Produces: `RootTabParamList`, `ROOT_TAB_ITEMS`, `RootTabs`, and root stack route `Home`.

- [ ] **Step 1: Write failing tab metadata test**

```ts
test('declares the three authenticated tabs', () => {
  expect(ROOT_TAB_ITEMS.map(item => item.label)).toEqual(['聊天', '通讯录', '我的']);
  expect(ROOT_TAB_ITEMS.map(item => item.name)).toEqual(['ChatsTab', 'ContactsTab', 'ProfileTab']);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --runInBand __tests__/RootTabs.test.tsx __tests__/App.test.tsx
```

- [ ] **Step 3: Define typed routes**

```ts
export type RootTabParamList = {
  ChatsTab: undefined;
  ContactsTab: undefined;
  ProfileTab: undefined;
};

export type RootStackParamList = {
  Login: undefined; Home: undefined; CreateGroup: undefined;
  Chat: ChatRouteParams;
  ConversationSettings: { cid: string; title: string };
  GroupDetails: { cid: string; groupId: number; title: string };
};
```

Use composite bottom-tab plus native-stack props for tab screens so `Chat` and `CreateGroup` navigation bubbles to the parent stack.

- [ ] **Step 4: Implement the tab shell and wire App**

```ts
export const ROOT_TAB_ITEMS = [
  { name: 'ChatsTab', label: '聊天', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles' },
  { name: 'ContactsTab', label: '通讯录', icon: 'people-outline', activeIcon: 'people' },
  { name: 'ProfileTab', label: '我的', icon: 'person-circle-outline', activeIcon: 'person-circle' },
] as const;
```

The themed tab bar is 70 points plus safe-area bottom, uses no native header, and renders active tint from `theme.colors.primary`. `App` places `ThemeProvider` above `StatusBar` and `NavigationContainer`, renders `Home` when authenticated, and retains every secondary screen.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- --runInBand __tests__/RootTabs.test.tsx __tests__/App.test.tsx
npx tsc --noEmit
git add im-client/packages/app-mobile/App.tsx im-client/packages/app-mobile/src/navigation im-client/packages/app-mobile/src/screens/ProfileScreen.tsx im-client/packages/app-mobile/__tests__
git commit -m "新增(IM客户端): 接入聊天通讯录我的标签栏"
```

Expected: tests and TypeScript pass before commit.

### Task 6: Complete Me and Appearance Settings

**Files:**
- Modify: `src/screens/ProfileScreen.tsx`
- Create: `src/components/AppearanceSelector.tsx`
- Create: `__tests__/ProfileScreen.test.tsx`

**Interfaces:**
- Consumes: `useAppStore`, `useAppTheme`, `ThemeMode`, and shared primitives.
- Produces: working appearance selection and logout with no dead rows.

- [ ] **Step 1: Write failing appearance tests**

```tsx
async function renderProfileScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider><ProfileScreen /></ThemeProvider>,
    );
  });
  return tree;
}

test('offers all appearance choices and logout', async () => {
  const tree = await renderProfileScreen();
  expect(tree.root.findByProps({ accessibilityLabel: '外观：跟随系统' })).toBeTruthy();
  expect(tree.root.findByProps({ accessibilityLabel: '外观：浅色' })).toBeTruthy();
  expect(tree.root.findByProps({ accessibilityLabel: '外观：深色' })).toBeTruthy();
  expect(tree.root.findByProps({ accessibilityLabel: '退出登录' })).toBeTruthy();
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --runInBand __tests__/ProfileScreen.test.tsx
```

- [ ] **Step 3: Implement exact options and supported content**

```ts
const APPEARANCE_OPTIONS = [
  { mode: 'system', label: '跟随系统', icon: 'phone-portrait-outline' },
  { mode: 'light', label: '浅色', icon: 'sunny-outline' },
  { mode: 'dark', label: '深色', icon: 'moon-outline' },
] as const;
```

Render `我的`, current avatar, display name, IM ID, connection state, the three appearance choices, and a danger-style logout button. Omit notification, storage, privacy, and help rows because they have no working destinations.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- --runInBand __tests__/ProfileScreen.test.tsx
git add im-client/packages/app-mobile/src/screens/ProfileScreen.tsx im-client/packages/app-mobile/src/components/AppearanceSelector.tsx im-client/packages/app-mobile/__tests__/ProfileScreen.test.tsx
git commit -m "新增(IM客户端): 完成我的与外观设置"
```

### Task 7: Redesign Bootstrap, Login, Chats, and Contacts

**Files:**
- Modify: `App.tsx`
- Modify: `src/screens/LoginScreen.tsx`
- Modify: `src/screens/ConversationsScreen.tsx`
- Modify: `src/screens/ContactsScreen.tsx`
- Create: `src/components/BrandedLoadingState.tsx`
- Create: `src/components/ConversationRowView.tsx`
- Create: `__tests__/ConversationRowView.test.tsx`

**Interfaces:**
- Produces: approved root-screen hierarchy with unchanged SDK calls.

- [ ] **Step 1: Write failing conversation row semantics test**

```tsx
const baseRow = {
  cid: 'c_1_2', type: 'SINGLE', peerId: 2, peerName: '苏晴',
  displayName: '苏晴', lastMsgPreview: '下午同步', lastMsgTs: Date.now(),
  unreadCount: 3, hasMention: true, muted: true,
} as ConversationRow;

async function renderConversationRow(overrides: Partial<ConversationRow>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ConversationRowView
          row={{ ...baseRow, ...overrides }} title="苏晴" formattedTime="10:24"
          entranceIndex={0} onPress={jest.fn()}
        />
      </ThemeProvider>,
    );
  });
  return tree;
}

test('announces mentions, mute, preview, and unread count', async () => {
  const button = (await renderConversationRow({ unreadCount: 3, hasMention: true, muted: true }))
    .root.findByProps({ accessibilityRole: 'button' });
  expect(button.props.accessibilityLabel).toContain('已开启消息免打扰');
  expect(button.props.accessibilityLabel).toContain('有人@我');
  expect(button.props.accessibilityLabel).toContain('3 条未读');
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --runInBand __tests__/ConversationRowView.test.tsx
```

- [ ] **Step 3: Implement bootstrap and login visuals**

`BrandedLoadingState` renders animated ambient circles, group avatar, `正在准备安全会话`, and any initialization error. Login uses themed layered gradients, elevated form surface, existing fields, existing login call, and existing error notice. Credential handling remains unchanged.

- [ ] **Step 4: Extract and redesign conversation row**

```ts
interface ConversationRowViewProps {
  row: ConversationRow; title: string; formattedTime: string;
  onPress: () => void; entranceIndex: number;
}
```

Render avatar, title, time, preview, mention, unread badge, and mute icon. Stagger only the first five visible rows; later rows have no added delay.

- [ ] **Step 5: Redesign Chats while preserving subscriptions**

Keep `reload`, `refresh`, `sdk.chat.on('conversation')`, and `sdk.chat.on('syncState')` unchanged. Render a date eyebrow, `聊天`, account/presence chip, search-shaped header, two 44-point creation actions, pull-to-refresh, local-content fallback, and current empty state.

- [ ] **Step 6: Redesign Contacts as a root tab**

Render `通讯录`, `快速找到团队里的每个人`, directory search, departments, and working organization/group shortcuts. Preserve directory loading, mounted guards, manual ID fallback, direct-conversation creation, and error copy.

- [ ] **Step 7: Verify and commit**

```bash
npm test -- --runInBand __tests__/ConversationRowView.test.tsx __tests__/App.test.tsx
npx tsc --noEmit
npm run lint -- --quiet
git add im-client/packages/app-mobile/App.tsx im-client/packages/app-mobile/src/screens/LoginScreen.tsx im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx im-client/packages/app-mobile/src/screens/ContactsScreen.tsx im-client/packages/app-mobile/src/components/BrandedLoadingState.tsx im-client/packages/app-mobile/src/components/ConversationRowView.tsx im-client/packages/app-mobile/__tests__
git commit -m "界面(IM客户端): 升级登录聊天与通讯录"
```

Expected: tests, TypeScript, and lint pass before commit.

### Task 8: Redesign Chat Detail and Message Motion

**Files:**
- Modify: `src/screens/ChatScreen.tsx`
- Create: `src/components/ChatHeader.tsx`
- Create: `src/components/ChatComposerSurface.tsx`
- Create: `src/components/AnimatedMessageBubble.tsx`
- Create: `__tests__/AnimatedMessageBubble.test.tsx`

**Interfaces:**
- Consumes: current ChatScreen state and callbacks.
- Produces: presentation-only header, composer, and message entrance wrapper.

- [ ] **Step 1: Write failing reduced-motion render test**

```tsx
test('always renders message content with reduced motion', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AnimatedMessageBubble
        messageId="m-1" isMine animateOnMount reduceMotionOverride
      >
        <Text>你好</Text>
      </AnimatedMessageBubble>,
    );
  });
  expect(tree.root.findByProps({ children: '你好' })).toBeTruthy();
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --runInBand __tests__/AnimatedMessageBubble.test.tsx
```

- [ ] **Step 3: Extract presentation-only units**

`ChatHeader` receives title, subtitle, back, and settings callbacks. `ChatComposerSurface` receives existing attachment, voice, emoji, text, submit, and disabled props without owning state. `AnimatedMessageBubble` receives message ID, ownership, `animateOnMount`, children, and an optional test-only `reduceMotionOverride?: boolean`; production callers omit the override.

- [ ] **Step 4: Apply approved visuals and motion**

Use themed header, message surfaces, and a floating composer 12 points from side and safe-area edges. Keep quotes, media, links, mentions, voice, system messages, action sheets, pickers, recording, read state, pagination, and retry wiring unchanged. Animate only newly appended local messages with opacity `0 → 1`, scale `0.96 → 1`, and translateY `8 → 0` over 220 ms. History and reduced-motion paths render immediately.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- --runInBand __tests__/AnimatedMessageBubble.test.tsx
npm test -- --runInBand
npx tsc --noEmit
git add im-client/packages/app-mobile/src/screens/ChatScreen.tsx im-client/packages/app-mobile/src/components/ChatHeader.tsx im-client/packages/app-mobile/src/components/ChatComposerSurface.tsx im-client/packages/app-mobile/src/components/AnimatedMessageBubble.tsx im-client/packages/app-mobile/__tests__/AnimatedMessageBubble.test.tsx
git commit -m "界面(IM客户端): 升级聊天页与消息动效"
```

Expected: focused, full, and TypeScript checks pass before commit.

### Task 9: Theme Groups, Settings, Media, Voice, and Overlays

**Files:**
- Modify: `src/screens/CreateGroupScreen.tsx`
- Modify: `src/screens/ConversationSettingsScreen.tsx`
- Modify: `src/screens/GroupDetailsScreen.tsx`
- Modify: `src/components/AttachmentPickerSheet.tsx`
- Modify: `src/components/ConversationMuteSetting.tsx`
- Modify: `src/components/DepartmentContactPicker.tsx`
- Modify: `src/components/EmojiPicker.tsx`
- Modify: `src/components/ImagePreviewModal.tsx`
- Modify: `src/components/LinkCardContent.tsx`
- Modify: `src/components/MediaMessageContent.tsx`
- Modify: `src/components/MentionPickerSheet.tsx`
- Modify: `src/components/MentionText.tsx`
- Modify: `src/components/MessageActionSheet.tsx`
- Modify: `src/components/MessageQuoteContent.tsx`
- Modify: `src/components/OutgoingMessageState.tsx`
- Modify: `src/components/VoiceComposerControl.tsx`
- Modify: `src/components/VoiceMessageContent.tsx`
- Modify: `src/components/VoiceRecordingOverlay.tsx`

**Interfaces:**
- Produces: zero direct `COLORS` imports outside theme definition and full dark coverage.

- [ ] **Step 1: Record remaining static imports**

```bash
rg -l "import .*COLORS.*ui/theme" src --glob "*.tsx"
```

- [ ] **Step 2: Convert secondary screens**

Replace static styles with theme-derived styles, themed shared headers, surfaces, rows, selection states, and buttons. Add one top-level entrance per screen. Preserve all SDK calls and route parameters.

- [ ] **Step 3: Convert remaining content and overlays**

Map backgrounds to `page`, `surface`, or `surfaceMuted`; text to `text` or `textSecondary`; separators to `border`; selected/playback to `primary`; destructive to `danger`; warnings to `warning`; modal scrims to `overlay`; recording scrims to `recordingOverlay`. Preserve public props, callbacks, labels, playback, and recording effects.

`VoiceRecordingOverlay` maps the existing recording level to a clamped `1.0–1.18` scale and `0.72–1.0` opacity on its microphone halo without starting a second audio subscription. When reduced motion is enabled, the halo remains static. Loading and empty-state illustrations use one `AnimatedEntrance` and do not loop.

- [ ] **Step 4: Verify dynamic theme coverage**

```bash
rg -n "import .*COLORS.*ui/theme" src --glob "*.tsx"
npm run lint -- --quiet
npx tsc --noEmit
npm test -- --runInBand
```

Expected: ripgrep has no output; lint, TypeScript, and tests exit 0.

- [ ] **Step 5: Commit**

```bash
git add im-client/packages/app-mobile/src/screens im-client/packages/app-mobile/src/components
git commit -m "界面(IM客户端): 完成群组与消息组件暗色适配"
```

### Task 10: Final Accessibility, Regression, and Android Verification

**Files:**
- Modify: only files with concrete violations found below.
- Modify: this plan to mark completed checkboxes.

**Interfaces:**
- Produces: fresh verification evidence without staging unrelated backend work.

- [ ] **Step 1: Inspect interaction semantics**

Every new press target must have a specific Chinese label, correct role and disabled semantics, and minimum 44-point dimensions. Selected appearance and tab states must have text or accessibility state in addition to color.

- [ ] **Step 2: Inspect motion cleanup**

Every repeating animation must stop during effect cleanup. Reduced motion must remove loops and stagger. List stagger runs only on initial entry; message motion never runs for loaded history.

- [ ] **Step 3: Run full app verification**

```bash
npm run lint
npx tsc --noEmit
npm test -- --runInBand
npm test -- --runInBand --coverage
```

Expected: zero lint errors, TypeScript exit 0, zero failed Jest suites or tests, and at least 80% statement coverage for the new theme, navigation, preference, and motion modules.

- [ ] **Step 4: Run Android validation**

```bash
./android/gradlew -p android app:assembleDebug
```

Expected: `BUILD SUCCESSFUL` and exit 0.

- [ ] **Step 5: Review scope and whitespace**

```bash
git status --short
git diff --check
git diff --stat HEAD~10..HEAD -- im-client/packages/app-mobile
```

Expected: no whitespace errors, only app-mobile files from this plan are included, and existing backend modifications remain untouched.

- [ ] **Step 6: Commit verification corrections only if needed**

```bash
git add im-client/packages/app-mobile
git commit -m "修复(IM客户端): 完善主题动效无障碍细节"
```

Skip this commit when Steps 1 and 2 require no correction.
