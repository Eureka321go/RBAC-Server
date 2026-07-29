# IM Client Full Visual Refresh Implementation Plan

**Status:** Complete — static verification passed and the user confirmed manual visual verification on 2026-07-29.

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

- [x] Install `@react-native-vector-icons/ionicons@13.1.2` at the npm workspace root and use its `/static` import for React Native CLI builds.
- [x] Define the exact blue/white/slate palette, page background, subtle border, danger colors, 8-based spacing, and 12/16 radii.
- [x] Implement the five reusable controls without data fetching or navigation dependencies.
- [x] Run `npx --no-install tsc -p packages/app-mobile --noEmit` from `im-client`; expect exit 0.
- [x] Commit as `feat(im-client): add unified mobile design system`.

### Task 2: Shared app chrome and avatar iconography

**Files:**
- Modify: `im-client/packages/app-mobile/App.tsx`
- Modify: `im-client/packages/app-mobile/src/components/Avatar.tsx`
- Modify: `im-client/packages/app-mobile/src/components/CompactScreenHeader.tsx`
- Modify: `im-client/packages/app-mobile/src/components/ConnectionStatusBar.tsx`

**Interfaces:**
- `GroupAvatar` uses the Ionicons `people` glyph and keeps the existing `size` prop.
- `CompactScreenHeader` adds optional icon-based right actions without changing current text-action compatibility.

- [x] Apply the common page background to boot state and navigation theme.
- [x] Replace the handcrafted group drawing with the fixed Ionicons group symbol.
- [x] Rebuild the header with a real back icon, centered title, white surface, subtle divider, and 44px controls.
- [x] Restyle connection state as a low-height, low-saturation notice while preserving all labels and colors by status.
- [x] Type-check and commit as `feat(im-client): refresh shared mobile chrome`.

### Task 3: Login and conversations

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/LoginScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx`

**Interfaces:**
- Consumes the controls and tokens from Tasks 1–2.
- Keeps existing `login`, `logout`, sync, event subscriptions, and navigation calls.

- [x] Build the login screen with welcome hierarchy, labeled fields, full-width primary action, pending feedback, and unified error notice.
- [x] Recompose the conversation header with the current-user identity and compact icon actions for single chat, group chat, and logout.
- [x] Render conversations as one white grouped list with fixed avatars, aligned preview text, mention state, and unread badges.
- [x] Preserve empty, refreshing, offline, and navigation behavior.
- [x] Type-check and commit as `feat(im-client): refresh login and conversations`.

### Task 4: Directory and group creation

**Files:**
- Modify: `im-client/packages/app-mobile/src/components/DepartmentContactPicker.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ContactsScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/CreateGroupScreen.tsx`

**Interfaces:**
- The picker retains its existing props and selection semantics.
- Both screens continue using `sdk.contacts.getDirectory()` and existing manual-ID fallbacks.

- [x] Restyle breadcrumbs, department rows, member rows, chevrons, selection controls, avatars, disabled states, and separators.
- [x] Place the picker in one grouped surface and visually demote manual-ID fallback fields.
- [x] Recompose group creation into a labeled name step, selected-member section, directory surface, and full-width primary create button.
- [x] Preserve department full-select, single-select navigation, manual IDs, and loading/error behavior.
- [x] Type-check and commit as `feat(im-client): refresh directory flows`.

### Task 5: Chat surface

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Keeps `namesById`, message ordering, send/resend, receipt, sync, and group-details navigation unchanged.

- [x] Apply the selected page background and header treatment.
- [x] Refine bubbles, sender label, avatars, delivery state, system rows, and error banner with the token palette while retaining top alignment and doubled message spacing.
- [x] Replace the native `Button` composer action with the primary circular send icon control and a rounded white input surface.
- [x] Preserve keyboard submission, retry, loading, and read-receipt behavior.
- [x] Type-check and commit as `feat(im-client): refresh chat surface`.

### Task 6: Group details and member action sheet

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/GroupDetailsScreen.tsx`

**Interfaces:**
- Reuses all current SDK actions: `renameGroup`, `addMembers`, `setMemberRole`, `setMemberMuted`, `transferOwner`, `removeMember`, `leaveGroup`, and `dissolveGroup`.
- Adds local `selectedMember: GroupMember | null` and `showRename: boolean` UI state only.

- [x] Recreate the selected target hierarchy: centered fixed group avatar, name, metadata, group-name settings row, member section, and isolated danger row.
- [x] Add member initials, role/status metadata, and one more button per manageable member; omit the current user's menu.
- [x] Implement a bottom member-action sheet whose visible actions exactly follow the existing owner/admin/target-role rules.
- [x] Move rename into a focused modal with cancel/save controls and existing validation.
- [x] Restyle the add-members modal using the new surface, picker, inputs, and buttons.
- [x] Preserve confirmations, error recovery, loading states, and local-conversation cleanup.
- [x] Type-check and commit as `feat(im-client): redesign group management`.

### Task 7: Static verification and visual QA

**Files:**
- Create: `im-client/design-qa.md`
- Modify: `docs/superpowers/plans/2026-07-29-im-client-visual-refresh.md`

**Interfaces:**
- Uses the selected reference at `/Users/xxmm/.codex/generated_images/019fab9c-4d95-7ae1-8da2-d0fb86e27ea5/exec-3a51703b-1a10-45ea-b944-784674266b90.png`.

- [x] Run SDK Core and App TypeScript checks; both must exit 0.
- [x] Run the SDK platform-import scan; expect no matches and exit 1.
- [x] Run `git diff dd45f24..HEAD --check`; expect exit 0.
- [x] Complete visual verification on the target Android client; the user performed the manual comparison and confirmed it passed.
- [x] Record hierarchy, typography, spacing, icon, interaction-target, and remaining polish findings in `im-client/design-qa.md`; the user completed manual visual verification and confirmed it passed.
- [x] Mark this plan complete and commit the completion documentation.

Visual completion was confirmed by the user on 2026-07-29. Codex did not perform an independent screenshot comparison.
