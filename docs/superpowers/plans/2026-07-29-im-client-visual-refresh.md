# IM Client Full Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild all six mobile-client screens around the user-selected second visual direction while preserving the existing IM behavior and data contracts.

**Architecture:** Introduce one typed design-token module and a small set of reusable native controls, then migrate shared chrome before individual screens. Keep all async actions and permission checks in their current screens; the group-details screen replaces dense inline member actions with a permission-aware bottom action sheet.

**Tech Stack:** React Native 0.86, React 19, TypeScript 5.8, Zustand, React Navigation 7, `@react-native-vector-icons/ionicons` 13.1.2.

## Global Constraints

- Use the displayed second generated option as the visual target.
- Preserve backend APIs, SDK protocol, SQLite schema, route names, and business permissions.
- User avatars use stable name initials; groups use a fixed group icon.
- Do not use text symbols, emoji, hand-drawn View icons, gradients, or nested cards.
- Primary tap targets are at least 44×44.
- Do not add or run automated tests, per the current project instruction.
- Do not push the branch.

---

### Task 1: Design tokens, icons, and reusable controls

**Files:**
- Modify: `im-client/package.json`
- Modify: `im-client/package-lock.json`
- Create: `im-client/packages/app-mobile/src/ui/theme.ts`
- Create: `im-client/packages/app-mobile/src/components/AppButton.tsx`
- Create: `im-client/packages/app-mobile/src/components/AppTextField.tsx`
- Create: `im-client/packages/app-mobile/src/components/IconButton.tsx`
- Create: `im-client/packages/app-mobile/src/components/Surface.tsx`
- Create: `im-client/packages/app-mobile/src/components/StatusNotice.tsx`

**Interfaces:**
- `COLORS`, `SPACING`, `RADIUS`, and `TYPE` are exported from `theme.ts`.
- `AppButton` supports `label`, `onPress`, `variant`, `disabled`, `loading`, and `icon`.
- `AppTextField` wraps React Native `TextInput` and supports a visible `label`.
- `IconButton` renders an Ionicons icon inside a 44px target.
- `Surface` provides the selected white grouped surface.

- [ ] Install `@react-native-vector-icons/ionicons@13.1.2` at the npm workspace root and use its `/static` import for React Native CLI builds.
- [ ] Define the exact blue/white/slate palette, page background, subtle border, danger colors, 8-based spacing, and 12/16 radii.
- [ ] Implement the five reusable controls without data fetching or navigation dependencies.
- [ ] Run `npx --no-install tsc -p packages/app-mobile --noEmit` from `im-client`; expect exit 0.
- [ ] Commit as `feat(im-client): add unified mobile design system`.

### Task 2: Shared app chrome and avatar iconography

**Files:**
- Modify: `im-client/packages/app-mobile/App.tsx`
- Modify: `im-client/packages/app-mobile/src/components/Avatar.tsx`
- Modify: `im-client/packages/app-mobile/src/components/CompactScreenHeader.tsx`
- Modify: `im-client/packages/app-mobile/src/components/ConnectionStatusBar.tsx`

**Interfaces:**
- `GroupAvatar` uses the Ionicons `people` glyph and keeps the existing `size` prop.
- `CompactScreenHeader` adds optional icon-based right actions without changing current text-action compatibility.

- [ ] Apply the common page background to boot state and navigation theme.
- [ ] Replace the handcrafted group drawing with the fixed Ionicons group symbol.
- [ ] Rebuild the header with a real back icon, centered title, white surface, subtle divider, and 44px controls.
- [ ] Restyle connection state as a low-height, low-saturation notice while preserving all labels and colors by status.
- [ ] Type-check and commit as `feat(im-client): refresh shared mobile chrome`.

### Task 3: Login and conversations

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/LoginScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx`

**Interfaces:**
- Consumes the controls and tokens from Tasks 1–2.
- Keeps existing `login`, `logout`, sync, event subscriptions, and navigation calls.

- [ ] Build the login screen with welcome hierarchy, labeled fields, full-width primary action, pending feedback, and unified error notice.
- [ ] Recompose the conversation header with the current-user identity and compact icon actions for single chat, group chat, and logout.
- [ ] Render conversations as one white grouped list with fixed avatars, aligned preview text, mention state, and unread badges.
- [ ] Preserve empty, refreshing, offline, and navigation behavior.
- [ ] Type-check and commit as `feat(im-client): refresh login and conversations`.

### Task 4: Directory and group creation

**Files:**
- Modify: `im-client/packages/app-mobile/src/components/DepartmentContactPicker.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ContactsScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/CreateGroupScreen.tsx`

**Interfaces:**
- The picker retains its existing props and selection semantics.
- Both screens continue using `sdk.contacts.getDirectory()` and existing manual-ID fallbacks.

- [ ] Restyle breadcrumbs, department rows, member rows, chevrons, selection controls, avatars, disabled states, and separators.
- [ ] Place the picker in one grouped surface and visually demote manual-ID fallback fields.
- [ ] Recompose group creation into a labeled name step, selected-member section, directory surface, and full-width primary create button.
- [ ] Preserve department full-select, single-select navigation, manual IDs, and loading/error behavior.
- [ ] Type-check and commit as `feat(im-client): refresh directory flows`.

### Task 5: Chat surface

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Keeps `namesById`, message ordering, send/resend, receipt, sync, and group-details navigation unchanged.

- [ ] Apply the selected page background and header treatment.
- [ ] Refine bubbles, sender label, avatars, delivery state, system rows, and error banner with the token palette while retaining top alignment and doubled message spacing.
- [ ] Replace the native `Button` composer action with the primary circular send icon control and a rounded white input surface.
- [ ] Preserve keyboard submission, retry, loading, and read-receipt behavior.
- [ ] Type-check and commit as `feat(im-client): refresh chat surface`.

### Task 6: Group details and member action sheet

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/GroupDetailsScreen.tsx`

**Interfaces:**
- Reuses all current SDK actions: `renameGroup`, `addMembers`, `setMemberRole`, `setMemberMuted`, `transferOwner`, `removeMember`, `leaveGroup`, and `dissolveGroup`.
- Adds local `selectedMember: GroupMember | null` and `showRename: boolean` UI state only.

- [ ] Recreate the selected target hierarchy: centered fixed group avatar, name, metadata, group-name settings row, member section, and isolated danger row.
- [ ] Add member initials, role/status metadata, and one more button per manageable member; omit the current user's menu.
- [ ] Implement a bottom member-action sheet whose visible actions exactly follow the existing owner/admin/target-role rules.
- [ ] Move rename into a focused modal with cancel/save controls and existing validation.
- [ ] Restyle the add-members modal using the new surface, picker, inputs, and buttons.
- [ ] Preserve confirmations, error recovery, loading states, and local-conversation cleanup.
- [ ] Type-check and commit as `feat(im-client): redesign group management`.

### Task 7: Static verification and visual QA

**Files:**
- Create: `im-client/design-qa.md`
- Modify: `docs/superpowers/plans/2026-07-29-im-client-visual-refresh.md`

**Interfaces:**
- Uses the selected reference at `/Users/xxmm/.codex/generated_images/019fab9c-4d95-7ae1-8da2-d0fb86e27ea5/exec-3a51703b-1a10-45ea-b944-784674266b90.png`.

- [ ] Run SDK Core and App TypeScript checks; both must exit 0.
- [ ] Run the SDK platform-import scan; expect no matches and exit 1.
- [ ] Run `git diff dd45f24..HEAD --check`; expect exit 0.
- [ ] Build/run the current native app if the available simulator environment permits, capture the group-details screen at the same state, and compare it with the selected reference.
- [ ] Record hierarchy, typography, spacing, icon, interaction-target, and remaining polish findings in `im-client/design-qa.md`; set `final result: passed` only when no P0/P1/P2 issue remains. If capture is unavailable, record `final result: blocked` and report that limitation without claiming visual verification.
- [ ] Mark this plan complete and commit documentation as `docs(im-client): complete visual refresh plan`.
