# RBAC 系统 —— 前端 RBAC 设计方案

> 记录时间：2026-07-08
> 当前基础：Vue 3 / Vite / TypeScript / Vue Router / Pinia / axios
> 本阶段目标：明确前端 RBAC 的页面结构、路由权限、按钮权限、状态管理、接口协作和实施顺序

---

## 一、设计目标

前端 RBAC 需要解决三个问题：

- 用户登录后能看到哪些菜单和页面。
- 用户进入页面后能操作哪些按钮。
- 登录态失效、权限变更、接口无权限时如何处理。

前端权限控制只负责用户体验和界面约束，不能作为最终安全边界。所有敏感操作仍必须由后端鉴权。

首期目标：

- 支持登录、登出、刷新 Token。
- 支持后端动态菜单生成前端路由。
- 支持页面按钮级权限控制。
- 支持用户、角色、菜单、部门等系统管理页面。
- 支持统一请求拦截、错误处理和无权限跳转。

---

## 二、整体架构

建议前端按以下目录扩展：

```text
frontend/src
├── api
│   ├── request.ts
│   ├── auth.ts
│   └── system
│       ├── user.ts
│       ├── role.ts
│       ├── menu.ts
│       ├── dept.ts
│       ├── post.ts
│       ├── config.ts
│       ├── dict.ts
│       └── log.ts
├── assets
├── components
│   ├── AppIcon.vue
│   ├── PermissionButton.vue
│   └── PageContainer.vue
├── directives
│   └── permission.ts
├── layouts
│   ├── BasicLayout.vue
│   └── AuthLayout.vue
├── router
│   ├── index.ts
│   ├── static-routes.ts
│   ├── dynamic-routes.ts
│   └── guard.ts
├── stores
│   ├── auth.ts
│   ├── permission.ts
│   ├── user.ts
│   └── tabs.ts
├── types
│   ├── auth.ts
│   ├── menu.ts
│   ├── permission.ts
│   └── system.ts
├── utils
│   ├── token.ts
│   ├── route.ts
│   └── tree.ts
└── views
    ├── auth
    │   └── LoginView.vue
    ├── dashboard
    │   └── DashboardView.vue
    ├── error
    │   ├── ForbiddenView.vue
    │   └── NotFoundView.vue
    └── system
        ├── user
        ├── role
        ├── menu
        ├── dept
        ├── post
        ├── config
        ├── dict
        └── log
```

设计原则：

- `api/` 只封装请求，不写页面逻辑。
- `stores/` 管登录态、用户信息、菜单、权限和缓存状态。
- `router/` 管静态路由、动态路由和导航守卫。
- `views/` 只负责页面组合和交互。
- 权限判断统一封装，避免散落字符串判断。

---

## 三、路由设计

### 1. 静态路由

静态路由是不依赖后端菜单的页面：

```text
/login
/403
/404
/redirect
/
```

建议：

- `/login` 使用 `AuthLayout`。
- 登录后的主框架使用 `BasicLayout`。
- `/` 默认重定向到 `/dashboard`。
- `403` 用于已登录但无权限。
- `404` 用于不存在的路由。

### 2. 动态路由

动态路由由后端菜单生成。

后端菜单字段建议前端消费：

| 字段 | 前端用途 |
|------|----------|
| `id` | 菜单唯一标识 |
| `parentId` | 生成菜单树 |
| `menuType` | 区分目录、菜单、按钮 |
| `menuName` | 菜单标题 |
| `path` | 路由路径 |
| `component` | 组件路径 |
| `permissionCode` | 权限标识 |
| `icon` | 菜单图标 |
| `visible` | 是否展示到侧边栏 |
| `keepAlive` | 是否缓存页面 |
| `sortOrder` | 排序 |
| `status` | 是否启用 |

前端只把 `DIR` 和 `MENU` 转成路由，`BUTTON` 只进入按钮权限集合。

动态路由生成流程：

```text
用户登录
保存 token
请求 /auth/me
请求 /auth/menus
请求 /auth/permissions
将菜单树转成 Vue Router 路由
router.addRoute 动态注册
进入目标页面
```

### 3. 组件映射

后端返回的 `component` 不应直接作为任意 import 路径执行，需要前端做白名单映射。

示例：

```ts
const viewModules = import.meta.glob('../views/**/*.vue')

function resolveView(component: string) {
  return viewModules[`../views/${component}.vue`]
}
```

如果后端返回不存在的组件：

- 开发环境提示配置错误。
- 生产环境跳转 `404` 或使用占位错误页。

---

## 四、权限模型

前端权限分三层：

```text
登录权限：是否有有效 token
路由权限：是否存在可访问菜单路由
按钮权限：是否拥有 permissionCode
```

### 1. 登录权限

登录状态由 `authStore` 管理：

```text
accessToken
refreshToken
expiresAt
userInfo
```

请求时通过 axios 拦截器注入：

```text
Authorization: Bearer <accessToken>
```

Token 过期策略：

- 请求返回 401 时尝试刷新 Token。
- 刷新成功后重放原请求。
- 刷新失败则清理登录态并跳转 `/login`。
- 多个请求同时 401 时，只允许一个刷新请求执行，其他请求排队等待结果。

### 2. 路由权限

路由权限由后端菜单控制。

导航守卫规则：

```text
访问白名单路由 -> 直接放行
没有 token -> 跳转 /login
有 token 但未加载用户信息 -> 加载用户、菜单、权限并注册动态路由
目标路由存在且有权限 -> 放行
目标路由不存在 -> /404
已登录访问 /login -> 跳转 /
```

动态路由需要避免重复注册：

- `permissionStore.routesLoaded = true` 表示已注册。
- 登出时调用 `router.removeRoute` 清理动态路由。
- 用户权限变化后重新拉取菜单并重建路由。

### 3. 按钮权限

按钮权限来自 `/auth/permissions`，保存为 `Set<string>`。

使用方式：

```vue
<button v-permission="'system:user:add'">新增用户</button>
```

或组件方式：

```vue
<PermissionButton permission="system:user:delete">
  删除
</PermissionButton>
```

判断规则：

```ts
function hasPermission(code: string) {
  return permissionSet.has(code)
}
```

超级管理员可以由后端直接返回所有权限，也可以前端识别 `super_admin` 后放行。推荐后端返回完整权限，前端不硬编码超级管理员特权。

---

## 五、状态管理

### 1. `authStore`

负责认证状态。

状态：

```text
accessToken
refreshToken
tokenExpiresAt
loginLoading
```

动作：

```text
login
logout
refreshToken
clearAuth
```

### 2. `userStore`

负责当前用户资料。

状态：

```text
id
username
nickname
avatar
deptId
deptName
roles
```

动作：

```text
fetchCurrentUser
clearUser
```

### 3. `permissionStore`

负责菜单、路由和权限集合。

状态：

```text
menus
routes
permissionCodes
routesLoaded
```

动作：

```text
fetchMenus
fetchPermissions
buildRoutes
resetRoutes
hasPermission
hasAnyPermission
hasAllPermissions
```

### 4. 持久化策略

建议：

- Token 可存 `localStorage` 或 `sessionStorage`。
- 用户信息、菜单、权限不长期持久化，刷新页面后重新请求。
- 如果使用 `localStorage`，需要明确 XSS 风险，前端不得把 Token 打到日志或页面。

---

## 六、页面设计

### 1. 登录页

功能：

- 账号、密码。
- 验证码预留。
- 登录错误提示。
- 回车提交。
- 登录成功后跳转原目标地址。

接口：

```text
POST /auth/login
GET  /auth/me
GET  /auth/menus
GET  /auth/permissions
```

### 2. 主布局

主布局组成：

- 顶部栏：折叠菜单、用户信息、退出登录。
- 侧边栏：动态菜单树。
- 面包屑：由路由 matched 生成。
- 内容区：页面主体。
- 可选标签页：后续扩展。

侧边栏只展示：

- `visible = true`
- `status = ENABLED`
- `menuType = DIR | MENU`
- 当前用户拥有的菜单。

### 3. 用户管理

页面能力：

- 查询：账号、昵称、手机号、部门、状态。
- 列表：账号、昵称、部门、角色、状态、创建时间。
- 操作：新增、编辑、删除、启用/禁用、重置密码、分配角色、分配岗位。

按钮权限：

```text
system:user:list
system:user:add
system:user:edit
system:user:delete
system:user:reset-password
system:user:assign-role
```

### 4. 角色管理

页面能力：

- 查询：角色名称、角色编码、状态。
- 列表：角色名称、编码、数据范围、状态、排序、创建时间。
- 操作：新增、编辑、删除、启用/禁用、分配菜单、分配数据权限、查看关联用户。

按钮权限：

```text
system:role:list
system:role:add
system:role:edit
system:role:delete
system:role:grant-menu
system:role:grant-data
```

角色授权交互：

- 菜单授权使用树形勾选。
- 数据权限使用单选项。
- 选择自定义部门时展示部门树。
- 保存前提示会影响已绑定用户权限。

### 5. 菜单管理

页面能力：

- 菜单树展示。
- 新增目录、菜单、按钮。
- 编辑路由、组件、权限标识、图标、排序。
- 启用/禁用。

按钮权限：

```text
system:menu:list
system:menu:add
system:menu:edit
system:menu:delete
```

### 6. 部门管理

页面能力：

- 部门树展示。
- 新增、编辑、删除、启用/禁用。
- 查看部门用户。

按钮权限：

```text
system:dept:list
system:dept:add
system:dept:edit
system:dept:delete
```

### 7. 日志、参数、字典

日志页面：

- 登录日志。
- 操作日志。
- 安全审计日志。
- 支持按用户、时间、状态、IP 查询。

参数页面：

- 参数查询、新增、编辑、删除。
- 敏感参数脱敏展示。

字典页面：

- 左侧字典类型。
- 右侧字典数据。

---

## 七、接口约定

前端统一通过 `src/api/request.ts` 访问后端。

响应结构沿用后端：

```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

后端数据库字段使用 `snake_case`，前端 API 类型统一使用 `camelCase`。前端不直接消费数据库字段名。

字段映射：

| 后端数据库字段 | 前端 API 字段 |
|----------------|---------------|
| `parent_id` | `parentId` |
| `menu_type` | `menuType` |
| `menu_name` | `menuName` |
| `permission_code` | `permissionCode` |
| `keep_alive` | `keepAlive` |
| `sort_order` | `sortOrder` |
| `role_code` | `roleCode` |
| `data_scope` | `dataScope` |

通用枚举：

| 场景 | 前端值 |
|------|--------|
| 启用状态 | `ENABLED` |
| 禁用状态 | `DISABLED` |
| 菜单目录 | `DIR` |
| 菜单页面 | `MENU` |
| 菜单按钮 | `BUTTON` |

分页响应建议：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "records": [],
    "total": 0,
    "page": 1,
    "pageSize": 20
  }
}
```

前端错误处理：

| 状态 | 处理 |
|------|------|
| 400 | 表单或请求参数错误，展示后端 message |
| 401 | Token 失效，刷新 Token 或跳登录 |
| 403 | 跳转 `/403` 或提示无权限 |
| 404 | 跳转 `/404` |
| 500 | 统一错误提示 |

---

## 八、安全与体验规则

- 前端不保存明文密码。
- 前端不在 console 输出 Token、密码和完整用户隐私信息。
- 前端按钮隐藏只是体验优化，后端必须再次鉴权。
- 权限接口加载失败时，不展示后台主页面。
- 修改角色、菜单、数据权限后，应提示用户重新登录或自动刷新权限。
- 表格中的删除、禁用、重置密码等危险操作必须二次确认。
- 表单提交按钮需要 loading 状态，避免重复提交。

---

## 九、实施顺序

### 阶段 1：认证与基础框架

- 登录页。
- Token 保存与请求拦截。
- 401 刷新 Token 和登出跳转。
- 主布局、侧边栏、顶部栏。

### 阶段 2：动态路由和菜单

- 静态路由。
- 后端菜单转前端路由。
- 导航守卫。
- 侧边栏动态菜单。
- 403 / 404 页面。

### 阶段 3：按钮权限

- `permissionStore`。
- `v-permission` 指令。
- `PermissionButton` 组件。
- 用户、角色、菜单、部门页面接入按钮权限。

### 阶段 4：系统管理页面

- 用户管理。
- 角色管理。
- 菜单管理。
- 部门管理。
- 岗位管理。
- 参数、字典、日志。

### 阶段 5：体验增强

- 标签页。
- 页面缓存。
- 字典缓存。
- 表格列设置。
- 导入导出。
- 权限变更后的自动刷新。

---

## 十、首期最小可用范围

首期建议只做：

- 登录、登出。
- 当前用户信息。
- 动态菜单。
- 动态路由。
- 按钮权限指令。
- 用户管理。
- 角色管理。
- 菜单管理。
- 部门管理。

暂缓：

- 标签页。
- 复杂页面缓存。
- 导入导出。
- 通知公告。
- 文件管理。
- 多租户切换。

这样能先把 RBAC 主链路跑通，再逐步补系统管理增强能力。

---

## 十一、与后端协作点

前端依赖后端稳定提供：

```text
POST /auth/login
POST /auth/logout
POST /auth/refresh-token
GET  /auth/me
GET  /auth/menus
GET  /auth/permissions
```

登录接口返回：

```json
{
  "accessToken": "access-token",
  "refreshToken": "refresh-token",
  "tokenType": "Bearer",
  "expiresIn": 7200
}
```

当前用户接口返回：

```json
{
  "id": 1,
  "username": "admin",
  "nickname": "超级管理员",
  "avatar": "",
  "deptId": 1,
  "deptName": "总部",
  "roles": [
    {
      "roleId": 1,
      "roleCode": "super_admin",
      "roleName": "超级管理员"
    }
  ]
}
```

菜单返回需要包含：

```text
id
parentId
menuType
menuName
path
component
permissionCode
icon
visible
keepAlive
sortOrder
status
children
```

菜单返回规则：

- 只返回当前用户可访问的启用菜单。
- `DIR` 和 `MENU` 用于生成路由和侧边栏。
- `BUTTON` 不进入菜单树，由 `/auth/permissions` 返回。
- `component = Layout` 表示主框架布局。
- 普通页面 `component` 使用相对 `views` 的路径，不带 `.vue` 后缀，例如 `system/user/UserView`。
- 前端必须通过 `import.meta.glob` 白名单映射组件，不能直接执行后端返回路径。

权限返回建议为字符串数组：

```json
[
  "system:user:list",
  "system:user:add",
  "system:role:grant-menu"
]
```

角色管理按钮权限码与后端保持一致：

```text
system:role:list
system:role:add
system:role:edit
system:role:delete
system:role:grant-menu
system:role:grant-data
```

后端接口返回 403 时，前端不能重试或刷新 Token，应直接提示无权限。
