# Workflow Approval Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete workflow approval frontend described in the approved design, plus the two minimal authenticated backend option endpoints required by ordinary users.

**Architecture:** Keep page-owned pagination and dialogs local, group API contracts by workflow domain, and share only instance details, status presentation, form conversion, and the global pending-task count. Add narrow backend option services that expose enabled definitions and limited enabled-user fields without granting system-management permissions.

**Tech Stack:** Java 21, Spring Boot 3.4.1, MyBatis-Plus, Vue 3.5, TypeScript 6, Pinia 3, Element Plus 2.14, Vite 8, Vitest.

## Global Constraints

- Preserve all pre-existing uncommitted workflow backend changes and unrelated user changes.
- Keep dynamic component paths exactly aligned with `backend/src/main/resources/db/data.sql`.
- All user-visible strings must exist in both `frontend/src/locales/zh-CN.ts` and `frontend/src/locales/en-US.ts`.
- Approval comments are at most 500 characters.
- Generic form values support only text, number, and boolean.
- The pending count refresh interval is 30 seconds and pauses while the document is hidden.
- Do not add BPMN, drag-and-drop design, WebSocket, business-specific forms, add-sign, or forced termination.

---

### Task 1: Frontend test runner and workflow domain utilities

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/types/workflow.ts`
- Create: `frontend/src/utils/workflow.ts`
- Create: `frontend/src/utils/workflow.spec.ts`

**Interfaces:**
- Produces: `FormFieldRow`, `WorkflowDefinition`, `WorkflowNode`, `WorkflowInstanceDetail`, `WorkflowTask`, `WorkflowCc`, `formRowsToData(rows)`, `workflowLabel(group, value, t)`, and `workflowTagType(group, value)`.

- [ ] **Step 1: Add the failing utility tests**

```ts
import { describe, expect, it } from 'vitest'
import { formRowsToData, workflowTagType } from './workflow'

describe('formRowsToData', () => {
  it('converts supported value types', () => {
    expect(formRowsToData([
      { key: 'reason', type: 'text', value: 'Trip' },
      { key: 'days', type: 'number', value: '4' },
      { key: 'urgent', type: 'boolean', value: true },
    ])).toEqual({ reason: 'Trip', days: 4, urgent: true })
  })

  it.each([
    [[{ key: '', type: 'text', value: 'x' }], 'workflow.form.keyRequired'],
    [[{ key: 'days', type: 'number', value: 'x' }], 'workflow.form.numberInvalid'],
    [[{ key: 'x', type: 'text', value: 'a' }, { key: 'x', type: 'text', value: 'b' }], 'workflow.form.keyDuplicate'],
  ])('rejects invalid rows', (rows, message) => {
    expect(() => formRowsToData(rows as never)).toThrow(message)
  })
})

describe('workflowTagType', () => {
  it('falls back safely for unknown values', () => {
    expect(workflowTagType('instance', 'FUTURE')).toBe('info')
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd frontend && npm test -- --run src/utils/workflow.spec.ts`
Expected: FAIL because Vitest and the utility module do not exist.

- [ ] **Step 3: Add Vitest and implement the typed utility boundary**

Add `"test": "vitest"` and `"test:coverage": "vitest run --coverage"` to scripts, add `vitest` to devDependencies, and keep the Vite Vue plugin configuration intact. Implement `formRowsToData` with trimmed unique keys, `Number.isFinite` validation, and boolean preservation. Implement status/action label key construction with raw-value fallback and Element Plus tag-type maps.

- [ ] **Step 4: Install and verify GREEN**

Run: `cd frontend && npm install && npm test -- --run src/utils/workflow.spec.ts`
Expected: all workflow utility tests PASS.

- [ ] **Step 5: Commit the task**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/types/workflow.ts frontend/src/utils/workflow.ts frontend/src/utils/workflow.spec.ts
git commit -m "test: add workflow frontend domain utilities"
```

### Task 2: Authenticated backend workflow options

**Files:**
- Create: `backend/src/main/java/com/rbac/workflow/definition/controller/DefinitionOptionController.java`
- Create: `backend/src/main/java/com/rbac/workflow/definition/service/DefinitionOptionService.java`
- Create: `backend/src/main/java/com/rbac/workflow/definition/vo/DefinitionOptionVO.java`
- Create: `backend/src/main/java/com/rbac/workflow/support/AssigneeOptionController.java`
- Create: `backend/src/main/java/com/rbac/workflow/support/AssigneeOptionService.java`
- Create: `backend/src/main/java/com/rbac/workflow/support/AssigneeUserOptionVO.java`
- Test: `backend/src/test/java/com/rbac/workflow/definition/DefinitionOptionServiceTest.java`
- Test: `backend/src/test/java/com/rbac/workflow/support/AssigneeOptionServiceTest.java`

**Interfaces:**
- Produces: `GET /workflow/definition/options` returning enabled latest definitions and `GET /workflow/assignee/users?keyword=&limit=20` returning limited enabled-user fields.

- [ ] **Step 1: Add failing Mockito service tests**

Test that definition options query `status = ENABLED`, sort by name and version descending, and collapse duplicate `processKey` values to the first entry. Test that assignee user search applies `status = ENABLED`, caps `limit` to 50, matches username or nickname, and fills department names without exposing email, phone, or password.

- [ ] **Step 2: Run backend tests and verify RED**

Run: `cd backend && mvn -Dtest=DefinitionOptionServiceTest,AssigneeOptionServiceTest test`
Expected: FAIL because the option types and methods do not exist.

- [ ] **Step 3: Implement minimal services and controllers**

`DefinitionOptionVO` contains `processKey`, `name`, `category`, `formKey`, and `version`. `DefinitionOptionController` owns only `/workflow/definition/options`, leaving the user's untracked definition controller and service untouched. `AssigneeUserOptionVO` contains `id`, `username`, `nickname`, and `deptName`. Controller methods have no static authority annotation, relying on the existing authenticated `/api/**` security rule. Validate `limit` by clamping it to `1..50` and trim the optional keyword.

- [ ] **Step 4: Run backend tests and compile**

Run: `cd backend && mvn -Dtest=DefinitionOptionServiceTest,AssigneeOptionServiceTest test && mvn -DskipTests package`
Expected: tests PASS and package completes successfully.

- [ ] **Step 5: Commit the task**

```bash
git add backend/src/main/java/com/rbac/workflow/definition/controller/DefinitionOptionController.java backend/src/main/java/com/rbac/workflow/definition/service/DefinitionOptionService.java backend/src/main/java/com/rbac/workflow/definition/vo/DefinitionOptionVO.java backend/src/main/java/com/rbac/workflow/support/AssigneeOptionController.java backend/src/main/java/com/rbac/workflow/support/AssigneeOptionService.java backend/src/main/java/com/rbac/workflow/support/AssigneeUserOptionVO.java backend/src/test/java/com/rbac/workflow/definition/DefinitionOptionServiceTest.java backend/src/test/java/com/rbac/workflow/support/AssigneeOptionServiceTest.java
git commit -m "feat: add workflow option endpoints"
```

### Task 3: Typed workflow API clients

**Files:**
- Create: `frontend/src/api/workflow/definition.ts`
- Create: `frontend/src/api/workflow/task.ts`
- Create: `frontend/src/api/workflow/instance.ts`
- Create: `frontend/src/api/workflow/assignee.ts`
- Create: `frontend/src/api/workflow/api.spec.ts`

**Interfaces:**
- Consumes: workflow domain types from Task 1 and `request` from `frontend/src/api/request.ts`.
- Produces: typed functions for every workflow controller route plus `listDefinitionOptions()` and `searchAssigneeUsers(keyword, limit)`.

- [ ] **Step 1: Write failing request-contract tests**

Mock `@/api/request` and assert representative calls exactly:

```ts
expect(request.get).toHaveBeenCalledWith('/workflow/task/todo', { params: { page: 1, pageSize: 10 } })
expect(request.post).toHaveBeenCalledWith('/workflow/task/8/approve', { comment: 'ok' })
expect(request.patch).toHaveBeenCalledWith('/workflow/definition/3/status', { status: 'DISABLED' })
expect(request.get).toHaveBeenCalledWith('/workflow/assignee/users', { params: { keyword: 'li', limit: 20 } })
```

- [ ] **Step 2: Run the API test and verify RED**

Run: `cd frontend && npm test -- --run src/api/workflow/api.spec.ts`
Expected: FAIL because workflow API modules do not exist.

- [ ] **Step 3: Implement all API modules**

Mirror the actual Java controllers: definition CRUD/status/detail/options, task todo/done/approve/reject/transfer, instance start/mine/detail/withdraw, cc mine/read, and assignee search. Use `PageResult<T>` and avoid `any`.

- [ ] **Step 4: Run the API and utility tests**

Run: `cd frontend && npm test -- --run src/api/workflow/api.spec.ts src/utils/workflow.spec.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit the task**

```bash
git add frontend/src/api/workflow frontend/src/types/workflow.ts
git commit -m "feat: add typed workflow API clients"
```

### Task 4: Shared workflow presentation and instance detail

**Files:**
- Create: `frontend/src/components/workflow/WorkflowStatusTag.vue`
- Create: `frontend/src/components/workflow/FormDataEditor.vue`
- Create: `frontend/src/views/workflow/instance/DetailDrawer.vue`
- Create: `frontend/src/components/workflow/FormDataEditor.spec.ts`

**Interfaces:**
- Consumes: Task 1 utilities and Task 3 `getInstanceDetail(id)`.
- Produces: `WorkflowStatusTag` props `{ group, value }`, `FormDataEditor` model `FormFieldRow[]`, and `DetailDrawer` exposed method `open(instanceId: number): Promise<void>`.

- [ ] **Step 1: Write the failing form-editor component test**

Mount the editor with one row, click add and remove, and assert `update:modelValue` emits immutable arrays. Assert number inputs and boolean switches render according to row type.

- [ ] **Step 2: Run the component test and verify RED**

Run: `cd frontend && npm test -- --run src/components/workflow/FormDataEditor.spec.ts`
Expected: FAIL because the components do not exist or Vue Test Utils is missing.

- [ ] **Step 3: Implement shared components and detail drawer**

Add `@vue/test-utils` and `jsdom` if required. The detail drawer fetches before becoming visible, renders descriptions, form-data table, task table, and record timeline, and formats complex form values using `JSON.stringify(value, null, 2)`.

- [ ] **Step 4: Run focused tests and type-check**

Run: `cd frontend && npm test -- --run src/components/workflow/FormDataEditor.spec.ts && npm run type-check`
Expected: test PASS and no Vue/TypeScript errors.

- [ ] **Step 5: Commit the task**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/workflow frontend/src/views/workflow/instance/DetailDrawer.vue
git commit -m "feat: add shared workflow detail components"
```

### Task 5: Workflow definition management page

**Files:**
- Create: `frontend/src/views/workflow/definition/definition-form.ts`
- Create: `frontend/src/views/workflow/definition/definition-form.spec.ts`
- Create: `frontend/src/views/workflow/definition/DefinitionView.vue`

**Interfaces:**
- Consumes: Task 3 definition and assignee APIs, existing role/post options, and permission directive.
- Produces: route component `workflow/definition/DefinitionView` and `serializeDefinitionForm(form)` that renumbers nodes and serializes assignee ID arrays.

- [ ] **Step 1: Write failing definition serialization tests**

Test node renumbering after reordering, comma serialization for `USER|ROLE|POST`, empty assignee values for contextual types, immutable process key during edit, and rejection of an empty node list or empty selected assignees.

- [ ] **Step 2: Run the test and verify RED**

Run: `cd frontend && npm test -- --run src/views/workflow/definition/definition-form.spec.ts`
Expected: FAIL because the form module does not exist.

- [ ] **Step 3: Implement serializer and DefinitionView**

Build filters, pagination, permission buttons, status switch action, delete confirmation, and a wide form dialog. Use explicit up/down controls, conditional assignee selectors, and Element Plus validation. Load full detail before editing because list rows do not contain nodes.

- [ ] **Step 4: Run tests and type-check**

Run: `cd frontend && npm test -- --run src/views/workflow/definition/definition-form.spec.ts && npm run type-check`
Expected: tests PASS and no type errors.

- [ ] **Step 5: Commit the task**

```bash
git add frontend/src/views/workflow/definition
git commit -m "feat: add workflow definition management"
```

### Task 6: My requests and copied-to-me pages

**Files:**
- Create: `frontend/src/views/workflow/instance/MineView.vue`
- Create: `frontend/src/views/workflow/instance/CcView.vue`
- Create: `frontend/src/views/workflow/instance/MineView.spec.ts`

**Interfaces:**
- Consumes: Task 3 instance APIs, Task 4 form editor/detail drawer, and `formRowsToData`.
- Produces: route components matching `workflow/instance/MineView` and `workflow/instance/CcView`.

- [ ] **Step 1: Add a failing start-payload integration test**

Mount `MineView`, choose an enabled definition, enter title/business key and mixed form rows, submit, and assert `startInstance` receives typed `formData`. Assert `RUNNING` rows expose withdraw while terminal rows do not.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd frontend && npm test -- --run src/views/workflow/instance/MineView.spec.ts`
Expected: FAIL because the view does not exist.

- [ ] **Step 3: Implement MineView and CcView**

Provide filters, pagination, empty states, shared status tags, detail opening, 500-character withdrawal comment, and unread marking on first open. Keep failed form submissions open with entered data intact.

- [ ] **Step 4: Run focused tests and type-check**

Run: `cd frontend && npm test -- --run src/views/workflow/instance/MineView.spec.ts && npm run type-check`
Expected: tests PASS and no type errors.

- [ ] **Step 5: Commit the task**

```bash
git add frontend/src/views/workflow/instance
git commit -m "feat: add workflow request and cc pages"
```

### Task 7: Todo, done, and global pending badge

**Files:**
- Create: `frontend/src/stores/workflow.ts`
- Create: `frontend/src/stores/workflow.spec.ts`
- Create: `frontend/src/views/workflow/task/TodoView.vue`
- Create: `frontend/src/views/workflow/task/DoneView.vue`
- Modify: `frontend/src/layouts/BasicLayout.vue`

**Interfaces:**
- Consumes: Task 3 task/assignee APIs and Task 4 detail drawer.
- Produces: `useWorkflowStore()` with `todoCount`, `refreshTodoCount()`, `startPolling()`, and `stopPolling()`.

- [ ] **Step 1: Write failing polling-store tests**

Use fake timers to assert immediate refresh, 30-second refresh, no interval refresh while hidden, immediate refresh after visibility returns, preservation of the previous count on failure, and cleanup by `stopPolling`.

- [ ] **Step 2: Run the store test and verify RED**

Run: `cd frontend && npm test -- --run src/stores/workflow.spec.ts`
Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement store, task pages, and header badge**

Todo actions use one 500-character comment model, require a target for transfer, disable all action buttons while submitting, and refresh both the table and global count after success. Done is read-only. Mount/unmount polling from `BasicLayout` and route the clickable badge to `/approval/todo`.

- [ ] **Step 4: Run store tests and type-check**

Run: `cd frontend && npm test -- --run src/stores/workflow.spec.ts && npm run type-check`
Expected: tests PASS and no type errors.

- [ ] **Step 5: Commit the task**

```bash
git add frontend/src/stores/workflow.ts frontend/src/stores/workflow.spec.ts frontend/src/views/workflow/task frontend/src/layouts/BasicLayout.vue
git commit -m "feat: add workflow task inbox and pending badge"
```

### Task 8: Internationalization and full verification

**Files:**
- Modify: `frontend/src/locales/zh-CN.ts`
- Modify: `frontend/src/locales/en-US.ts`
- Modify: any workflow files identified by verification failures

**Interfaces:**
- Consumes: every translation key referenced by Tasks 1–7.
- Produces: complete bilingual workflow UI and a verified build.

- [ ] **Step 1: Add complete locale trees**

Define matching `workflow` keys for common fields, definitions, nodes, forms, instances, tasks, cc, status/action labels, confirmations, validation, success messages, empty states, and the header badge. Keep identical object shapes in both locale files.

- [ ] **Step 2: Run all frontend quality gates**

Run: `cd frontend && npm test -- --run && npm run type-check && npm run lint && npm run build`
Expected: all tests PASS; type-check, lint, and production build exit 0.

- [ ] **Step 3: Run backend verification**

Run: `cd backend && mvn test && mvn -DskipTests package`
Expected: tests PASS and package exits 0.

- [ ] **Step 4: Review the final diff and dynamic routes**

Run: `git diff --check && git status --short && rg -n "workflow/(definition/DefinitionView|task/TodoView|task/DoneView|instance/MineView|instance/CcView)" backend/src/main/resources/db/data.sql frontend/src/views`
Expected: no whitespace errors; every menu component has a matching `.vue` file; unrelated user changes remain untouched.

- [ ] **Step 5: Commit verification fixes and locales**

```bash
git add frontend/src/locales frontend/src/api/workflow frontend/src/components/workflow frontend/src/views/workflow frontend/src/stores/workflow.ts frontend/src/utils/workflow.ts frontend/src/types/workflow.ts
git commit -m "feat: complete workflow approval frontend"
```
