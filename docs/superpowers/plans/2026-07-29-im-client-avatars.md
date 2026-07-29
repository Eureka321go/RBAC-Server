# IM Client Avatars and Sender Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable initial avatars across conversations, messages, and contacts, use a fixed group icon, and identify senders in group message threads.

**Architecture:** Add focused presentational avatar components with no data fetching. Existing screens resolve display names from local conversation rows, authenticated-user state, group members, and the complete contact directory, then pass normalized values into those components.

**Tech Stack:** React Native 0.86, React 19, TypeScript, Zustand, existing IM SDK services.

## Global Constraints

- Do not add backend fields, database migrations, image upload, or image caching.
- Do not add a third-party icon dependency; build the fixed group icon from React Native views.
- Do not add or run tests, per the current project instruction.
- User avatar color must remain stable for the same numeric user ID.
- System messages remain centered and have no avatar.

---

### Task 1: Reusable avatar components

**Files:**
- Create: `im-client/packages/app-mobile/src/components/Avatar.tsx`

**Interfaces:**
- Produces: `InitialAvatar({ name, userId, size? })` and `GroupAvatar({ size? })` React components.

- [ ] **Step 1: Implement `InitialAvatar`**

Normalize `name`, take `Array.from(name)[0]`, uppercase Latin letters, and fall back to `U`. Choose one of six fixed colors with `Math.abs(userId ?? 0) % palette.length`. Derive the font size from the optional avatar size, defaulting to 42.

- [ ] **Step 2: Implement `GroupAvatar`**

Render a fixed blue circular container with two overlapping white head-and-shoulder silhouettes made from nested `View` elements. Do not derive the icon from group name or group ID.

- [ ] **Step 3: Type-check and commit**

Run: `cd im-client && npx --no-install tsc -p packages/app-mobile --noEmit`

Expected: exit code 0.

```bash
git add im-client/packages/app-mobile/src/components/Avatar.tsx
git commit -m "feat(im-client): add reusable identity avatars"
```

### Task 2: Conversation-list avatars

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx`

**Interfaces:**
- Consumes: `InitialAvatar` and `GroupAvatar` from Task 1.
- Uses: `ConversationRow.peerId`, `peerName`, `displayName`, and `type`.

- [ ] **Step 1: Add avatars to the list**

Calculate each row title once. Render `GroupAvatar` before group rows; render `InitialAvatar` with the calculated title and `peerId` before single-chat rows. Keep unread badges, previews, mentions, and navigation unchanged.

- [ ] **Step 2: Reuse `InitialAvatar` for the signed-in profile**

Remove the screen-local letter helper and profile-circle styles. Render the shared avatar with the signed-in display name and user ID.

- [ ] **Step 3: Type-check and commit**

Run: `cd im-client && npx --no-install tsc -p packages/app-mobile --noEmit`

Expected: exit code 0.

```bash
git add im-client/packages/app-mobile/src/screens/ConversationsScreen.tsx
git commit -m "feat(im-client): show avatars in conversation list"
```

### Task 3: Contact-member avatars

**Files:**
- Modify: `im-client/packages/app-mobile/src/components/DepartmentContactPicker.tsx`

**Interfaces:**
- Consumes: `InitialAvatar` from Task 1.
- Uses: `ContactMember.displayName` and `ContactMember.userId`.

- [ ] **Step 1: Add user avatars to member rows**

Render a compact `InitialAvatar` before the member text. In multi-select mode keep the checkbox first, followed by the avatar and member details. Preserve disabled opacity, selection highlighting, press behavior, and department rows.

- [ ] **Step 2: Type-check and commit**

Run: `cd im-client && npx --no-install tsc -p packages/app-mobile --noEmit`

Expected: exit code 0.

```bash
git add im-client/packages/app-mobile/src/components/DepartmentContactPicker.tsx
git commit -m "feat(im-client): show avatars in contact directory"
```

### Task 4: Message avatars and group sender names

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: `InitialAvatar` from Task 1.
- Uses: authenticated `displayName`, existing group/directory name map, and `ChatMessage.senderId`.

- [ ] **Step 1: Generalize the group name map**

Rename `systemNamesById` to `namesById` because regular messages also consume it. Continue merging directory names first and group-member names second so current membership wins.

- [ ] **Step 2: Resolve sender identity**

Read the signed-in display name from Zustand. Resolve own messages from signed-in state and peer messages from `namesById`; fall back to `用户 #ID` or `未知用户`.

- [ ] **Step 3: Render aligned avatars and group names**

For peer messages render avatar then message content. For own messages render message content then avatar. Show the sender-name label above peer bubbles only in group chats. Keep delivery state, spinner, retry, and system rows intact.

- [ ] **Step 4: Type-check and commit**

Run: `cd im-client && npx --no-install tsc -p packages/app-mobile --noEmit`

Expected: exit code 0.

```bash
git add im-client/packages/app-mobile/src/screens/ChatScreen.tsx
git commit -m "feat(im-client): identify message senders"
```

### Task 5: Final static verification and plan record

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-avatars.md`

**Interfaces:**
- Verifies all prior tasks without installing dependencies or running tests.

- [ ] **Step 1: Run both TypeScript checks**

Run from `im-client`: `npx --no-install tsc -p packages/im-sdk-core --noEmit` and `npx --no-install tsc -p packages/app-mobile --noEmit`.

Expected: both commands exit 0.

- [ ] **Step 2: Verify boundaries and formatting**

Run the existing SDK platform-import scan and `git diff a358787..HEAD --check`.

Expected: platform scan has no matches; diff check exits 0.

- [ ] **Step 3: Record completion and commit**

Mark every plan checkbox complete, record exact verification outcomes, and commit with `docs(im-client): complete avatar implementation plan`.
