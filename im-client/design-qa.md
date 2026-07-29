# IM Client Visual Refresh QA

Date: 2026-07-29

Reference: `/Users/xxmm/.codex/generated_images/019fab9c-4d95-7ae1-8da2-d0fb86e27ea5/exec-3a51703b-1a10-45ea-b944-784674266b90.png`

## Static verification

- SDK Core TypeScript: passed (`npx --no-install tsc -p packages/im-sdk-core --noEmit`)
- App TypeScript: passed (`npx --no-install tsc -p packages/app-mobile --noEmit`)
- SDK platform-import boundary: passed (no React Native imports found under `packages/im-sdk-core/src`)
- Git whitespace/error check: passed for `dd45f24..HEAD` and the current worktree

## Manual visual verification

The user asked to perform visual verification personally. No simulator screenshot comparison was completed by Codex, so this document does not claim a visual pass.

Check the following on the target Android viewport:

- Login: safe area, welcome hierarchy, labeled fields, focus border, disabled/loading state, and error notice.
- Conversations: current-account header, three 44×44 actions, online indicator, single grouped list, title/preview/time alignment, mention label, unread badge, empty state, and pull-to-refresh.
- Contacts: breadcrumbs at multiple department depths, department/member rows, single-select behavior, disabled current user, and manual user-ID fallback.
- Create group: group-name card, selected count, multi-select and department select-all, manual user-ID supplement, keyboard clearance, and primary action state.
- Chat: compact header, own/peer avatar alignment, group sender names, bubble spacing, sent/read/failure states, composer, keyboard submission, and retry.
- Group details: centered group identity, settings rows, member separators, action-sheet permissions, rename modal, add-member modal, and destructive confirmations.
- Global: blue/white/slate palette, typography hierarchy, 12–16 px radii, no nested cards, no clipped text, no status-bar overlap, and tap targets of at least 44×44.

## Result

`final result: pending user visual verification`

After manual verification, replace the result with `passed` or record each issue with its page, severity, and reproduction steps.
