# RBAC 系统 —— 后端设计文档

> 记录时间：2026-07-08
> 当前基础：Spring Boot 3.4.1 / JDK 21 / Spring Security / MyBatis-Plus / MySQL / Redis
> 本阶段目标：明确 RBAC 后端的模块边界、权限模型、数据表、接口规划和实施顺序

---

## 一、设计目标

本系统定位为通用后台管理系统的权限与系统管理底座，后端需要支撑：

- 用户、角色、菜单、部门等基础管理能力。
- 菜单权限、按钮权限、接口权限、数据权限的统一控制。
- 登录认证、Token 会话、在线用户和强制下线。
- 登录日志、操作日志、安全审计日志。
- 参数、字典等系统配置能力，减少硬编码。
- 后续业务模块可以复用统一鉴权、数据范围、审计和基础字典。

首期目标不是一次性做复杂 IAM 平台，而是先建立清晰、可扩展、可测试的 RBAC 基础架构。

---

## 二、推荐模块

### 1. 认证中心

负责登录态和身份识别。

核心能力：

- 账号密码登录。
- 图形验证码或短信验证码预留。
- 登录失败次数限制和账号临时锁定。
- Access Token + Refresh Token。
- Redis 保存会话、Token 黑名单或在线用户状态。
- 登出、刷新 Token、强制下线。
- 获取当前登录用户信息、权限标识、菜单树。

建议：

- 密码使用 `BCryptPasswordEncoder`。
- Token 使用短期 Access Token 和长期 Refresh Token。
- 后台管理系统建议保留 Redis 会话记录，方便在线用户管理和强退。

### 2. 用户管理

负责账号生命周期。

核心能力：

- 用户新增、编辑、删除、启用、禁用。
- 用户列表分页、按账号/昵称/手机号/部门/状态查询。
- 密码重置、修改密码。
- 分配角色。
- 分配岗位。
- 绑定部门。
- 查询用户拥有的菜单、按钮和数据权限。

关键规则：

- 超级管理员账号不允许被普通管理员禁用、删除或降权。
- 删除用户建议使用逻辑删除。
- 用户名、手机号、邮箱需要唯一性校验。

### 3. 角色管理

角色是权限集合，是 RBAC 的核心模块，建议作为独立模块补充。

核心能力：

- 角色新增、编辑、删除、启用、禁用。
- 角色编码唯一，例如 `admin`、`system_manager`。
- 角色分配菜单和按钮权限。
- 角色分配数据权限范围。
- 查询角色已绑定用户。

数据权限范围建议支持：

| 类型 | 含义 |
|------|------|
| `ALL` | 全部数据 |
| `CUSTOM_DEPT` | 自定义部门 |
| `OWN_DEPT` | 本部门 |
| `OWN_DEPT_CHILD` | 本部门及子部门 |
| `SELF` | 仅本人数据 |

#### 角色管理详细设计

角色管理需要同时解决“能访问哪些功能”和“能看到哪些数据”两个问题。

角色基础信息：

- `role_name`：角色名称，用于页面展示。
- `role_code`：角色编码，用于程序判断，创建后不建议频繁修改。
- `data_scope`：数据权限范围。
- `sort_order`：排序。
- `status`：启用或禁用。
- `remark`：备注。

角色授权内容：

```text
角色 -> 菜单目录
角色 -> 页面菜单
角色 -> 按钮权限
角色 -> 数据权限范围
角色 -> 自定义部门范围
```

角色管理页面建议拆成三个操作区：

1. **基础信息**
   - 维护名称、编码、排序、状态、备注。

2. **功能权限**
   - 使用菜单树勾选目录、菜单、按钮。
   - 保存到 `sys_role_menu`。
   - 前端动态路由和按钮权限都从这里生成。

3. **数据权限**
   - 选择数据范围。
   - 当范围为 `CUSTOM_DEPT` 时，展示部门树并保存到 `sys_role_dept`。
   - 其他范围不需要保存自定义部门，保存时应清理旧的 `sys_role_dept` 记录。

关键校验规则：

- `role_code` 全局唯一。
- 内置角色不允许删除，例如超级管理员。
- 禁用角色后，该角色不再参与权限计算。
- 删除角色前需要检查是否仍有用户绑定。
- 修改角色菜单或数据权限后，需要清理相关用户权限缓存。
- 当前登录用户不能通过修改自己的角色导致失去角色管理权限，首期可以禁止用户修改自己拥有的最高权限角色。

推荐内置角色：

| 角色编码 | 角色名称 | 说明 |
|----------|----------|------|
| `super_admin` | 超级管理员 | 拥有所有功能和全部数据 |
| `system_admin` | 系统管理员 | 管理用户、角色、菜单、部门、参数 |
| `audit_admin` | 审计管理员 | 查看登录日志、操作日志、安全审计日志 |

角色权限计算规则：

```text
用户拥有多个启用角色时：
功能权限 = 所有启用角色的菜单/按钮权限并集
数据权限 = 按最大数据范围合并
```

数据范围合并优先级：

```text
ALL > CUSTOM_DEPT > OWN_DEPT_CHILD > OWN_DEPT > SELF
```

如果多个角色都是 `CUSTOM_DEPT`，则部门范围取并集。

### 4. 菜单管理

菜单同时承担前端路由、侧边栏、页面按钮权限点的配置。

菜单类型建议分为：

| 类型 | 说明 |
|------|------|
| `DIR` | 目录，仅用于分组 |
| `MENU` | 菜单，对应前端路由和页面 |
| `BUTTON` | 按钮或页面操作权限 |

核心能力：

- 菜单树新增、编辑、删除、排序。
- 配置路由路径、组件路径、图标、权限标识。
- 配置是否隐藏、是否缓存、是否外链。
- 生成当前用户动态路由和按钮权限集合。

权限标识示例：

```text
system:user:list
system:user:add
system:user:edit
system:user:delete
system:user:reset-password
system:user:assign-role
system:role:list
system:role:add
system:role:edit
system:role:delete
system:role:grant-menu
system:role:grant-data
```

### 5. 部门管理

部门是组织结构和数据权限的基础。

核心能力：

- 部门树新增、编辑、删除、启用、禁用。
- 维护负责人、电话、邮箱、排序。
- 查询部门用户。
- 为角色数据权限提供部门范围。

关键规则：

- 存在子部门时不允许删除父部门。
- 存在用户时不允许直接删除部门。
- 禁用部门后，其下用户是否允许登录需要作为业务规则明确，首期建议不联动禁用用户，只限制新增用户选择该部门。

### 6. 岗位管理

岗位偏组织属性，角色偏权限集合。建议补充岗位管理，避免把组织职务和权限角色混在一起。

核心能力：

- 岗位新增、编辑、删除、启用、禁用。
- 用户绑定一个或多个岗位。
- 可用于用户筛选、组织展示和后续审批流。

### 7. 日志管理

日志需要覆盖登录、操作、安全审计三个层次。

登录日志：

- 登录账号、用户 ID、IP、地点、浏览器、操作系统。
- 登录结果、失败原因、登录时间。

操作日志：

- 操作模块、操作类型、请求方法、请求 URL。
- 操作人、部门、IP、请求参数摘要、响应结果、耗时。
- 异常信息。

安全审计日志：

- 改密码、重置密码。
- 授权角色、修改角色权限。
- 禁用用户、强退用户。
- 修改系统参数。

建议：

- 操作日志使用注解 + AOP 采集。
- 日志写入使用异步队列或事件，避免影响主请求。
- 敏感字段如密码、Token、身份证号必须脱敏。

### 8. 参数管理

参数管理用于运行时配置。

示例参数：

```text
security.login.captcha.enabled
security.login.max-fail-count
security.password.default
security.token.access-ttl
security.token.refresh-ttl
system.file.max-size
```

关键规则：

- 内置参数不允许删除。
- 敏感参数不允许明文返回。
- 修改参数必须记录安全审计日志。
- 高频读取参数可以缓存到 Redis，本地缓存要注意刷新机制。

### 9. 字典管理

建议补充字典管理，统一维护枚举数据。

示例：

- 用户状态。
- 菜单类型。
- 操作类型。
- 日志状态。
- 性别。
- 是否标识。

字典分为字典类型和字典数据两层：

- `sys_dict_type`：字典分类。
- `sys_dict_data`：具体键值项。

### 10. 通知公告

可作为系统管理扩展模块。

核心能力：

- 公告新增、发布、撤回、删除。
- 登录后展示有效公告。
- 后续扩展站内信、已读未读。

---

## 三、权限模型

推荐模型：

```text
用户 -> 角色 -> 菜单 / 按钮 / API 权限
用户 -> 部门
角色 -> 数据权限范围
```

认证后生成当前用户上下文：

```text
userId
username
deptId
roleCodes
permissionCodes
dataScope
```

后端鉴权建议分三层：

1. **接口访问控制**
   - Spring Security 判断是否登录。
   - `@PreAuthorize` 判断权限标识。

2. **业务操作控制**
   - Service 层校验业务规则，例如不能删除超级管理员。
   - 授权、禁用、重置密码等敏感动作必须二次校验。

3. **数据权限控制**
   - 对列表查询自动追加部门或本人范围。
   - 首期可以通过 Service 层统一工具构造查询条件。
   - 后续可扩展 MyBatis 拦截器。

### 数据权限详细设计

数据权限的目标是限制“用户能看哪些业务数据”，不能只靠前端隐藏。后端所有涉及数据列表和详情的接口都需要在查询时应用数据范围。

#### 1. 数据归属字段

业务表要支持数据权限，必须能判断数据属于谁或哪个部门。建议业务表按场景预留：

| 字段 | 说明 |
|------|------|
| `dept_id` | 数据所属部门 |
| `created_by` | 数据创建人 |
| `owner_user_id` | 数据负责人，业务需要时增加 |

系统管理表不是全部都需要数据权限。例如角色、菜单、参数这类全局配置通常只做功能权限，不做部门范围过滤。用户、日志、业务单据等更适合接入数据权限。

#### 2. 数据范围规则

| 数据范围 | 查询规则 |
|----------|----------|
| `ALL` | 不追加数据范围条件 |
| `CUSTOM_DEPT` | `dept_id IN (角色绑定部门及其子部门)` |
| `OWN_DEPT` | `dept_id = 当前用户部门` |
| `OWN_DEPT_CHILD` | `dept_id IN (当前用户部门及子部门)` |
| `SELF` | `created_by = 当前用户 ID` 或 `owner_user_id = 当前用户 ID` |

当用户没有部门时：

- `OWN_DEPT` 和 `OWN_DEPT_CHILD` 返回空结果。
- `SELF` 仍可按本人过滤。
- `ALL` 不受影响。

#### 3. 多角色合并

用户可能拥有多个角色，数据权限按最大可见范围合并：

```text
1. 任一角色是 ALL：返回 ALL
2. 存在 CUSTOM_DEPT：合并所有自定义部门
3. 存在 OWN_DEPT_CHILD：加入当前部门及子部门
4. 存在 OWN_DEPT：加入当前部门
5. 存在 SELF：加入本人条件
```

合并后的查询条件可以表示为：

```text
dept_id IN allowedDeptIds OR created_by = currentUserId
```

如果没有任何有效角色，返回空结果。

#### 4. 后端实现方式

首期建议使用 Service 层显式接入，避免 MyBatis 拦截器过早增加复杂度。

推荐抽象：

```text
DataScopeContext
DataScopeService
DataScopeQuery
```

职责：

- `DataScopeContext`：保存当前用户 ID、部门 ID、角色编码、权限标识。
- `DataScopeService`：根据用户角色计算允许访问的部门 ID 和本人条件。
- `DataScopeQuery`：给具体查询传入 `allowedDeptIds`、`selfUserId`、`includeSelf`。

列表查询流程：

```text
Controller 接收查询条件
Service 获取当前登录用户
Service 计算数据范围
Mapper 按业务查询条件 + 数据范围条件查询
返回分页结果
```

Mapper 条件示例：

```sql
AND (
  dept_id IN (...)
  OR created_by = #{selfUserId}
)
```

如果接口只允许本人数据，可直接使用 `SELF` 规则，不需要走角色数据范围合并。

#### 5. 适用接口

建议首期接入数据权限的接口：

- 用户列表：普通管理员只能看授权部门下的用户。
- 登录日志：按操作人部门过滤。
- 操作日志：按操作人部门过滤。
- 后续业务单据列表：按单据归属部门或创建人过滤。

不建议首期接入数据权限的接口：

- 菜单管理。
- 角色管理。
- 参数管理。
- 字典管理。

这些属于系统级配置，使用功能权限控制即可。

#### 6. 数据权限变更后的缓存处理

以下操作需要清理用户权限或数据范围缓存：

- 给用户分配角色。
- 移除用户角色。
- 修改角色 `data_scope`。
- 修改角色自定义部门。
- 禁用或删除角色。
- 用户更换部门。

示例：

```java
@PreAuthorize("hasAuthority('system:user:add')")
@PostMapping("/system/users")
public Result<Long> createUser(@Valid @RequestBody UserCreateRequest request) {
    return Result.success(userService.createUser(request));
}
```

---

## 四、后端包结构

建议从当前 `com.rbac` 继续扩展，按领域模块组织：

```text
com.rbac
├── auth
│   ├── controller
│   ├── service
│   ├── dto
│   └── vo
├── common
│   ├── domain
│   ├── exception
│   ├── web
│   └── util
├── security
│   ├── config
│   ├── filter
│   ├── handler
│   └── model
└── system
    ├── user
    ├── role
    ├── menu
    ├── dept
    ├── post
    ├── config
    ├── dict
    ├── log
    └── notice
```

每个业务模块内部建议保持：

```text
controller
service
mapper
entity
dto
vo
```

通用基础能力：

- `BaseEntity`：`id`、`createdBy`、`createdAt`、`updatedBy`、`updatedAt`、`deleted`。
- `PageRequest` / `PageResult`：统一分页请求和响应。
- `Result<T>`：统一响应。
- `BusinessException`：统一业务异常。
- `GlobalExceptionHandler`：统一异常处理。

---

## 五、核心数据表

### 1. 用户表 `sys_user`

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `dept_id` | 部门 ID |
| `username` | 登录账号，唯一 |
| `nickname` | 昵称 |
| `password` | BCrypt 密码 |
| `email` | 邮箱 |
| `phone` | 手机号 |
| `avatar` | 头像 |
| `gender` | 性别字典值 |
| `status` | 状态：启用/禁用 |
| `last_login_at` | 最后登录时间 |
| `last_login_ip` | 最后登录 IP |
| `remark` | 备注 |
| `created_by` / `created_at` | 创建信息 |
| `updated_by` / `updated_at` | 更新信息 |
| `deleted` | 逻辑删除 |

### 2. 角色表 `sys_role`

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `role_name` | 角色名称 |
| `role_code` | 角色编码，唯一 |
| `data_scope` | 数据权限范围 |
| `builtin` | 是否内置角色 |
| `sort_order` | 排序 |
| `status` | 状态 |
| `remark` | 备注 |
| `created_by` / `created_at` | 创建信息 |
| `updated_by` / `updated_at` | 更新信息 |
| `deleted` | 逻辑删除 |

### 3. 菜单表 `sys_menu`

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `parent_id` | 父菜单 ID |
| `menu_type` | `DIR` / `MENU` / `BUTTON` |
| `menu_name` | 菜单名称 |
| `path` | 路由路径 |
| `component` | 前端组件路径 |
| `permission_code` | 权限标识 |
| `icon` | 图标 |
| `sort_order` | 排序 |
| `visible` | 是否显示 |
| `keep_alive` | 是否缓存 |
| `external_link` | 外链地址 |
| `status` | 状态 |
| `created_by` / `created_at` | 创建信息 |
| `updated_by` / `updated_at` | 更新信息 |
| `deleted` | 逻辑删除 |

### 4. 部门表 `sys_dept`

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `parent_id` | 父部门 ID |
| `dept_name` | 部门名称 |
| `leader_user_id` | 负责人用户 ID |
| `phone` | 联系电话 |
| `email` | 邮箱 |
| `sort_order` | 排序 |
| `status` | 状态 |
| `created_by` / `created_at` | 创建信息 |
| `updated_by` / `updated_at` | 更新信息 |
| `deleted` | 逻辑删除 |

### 5. 岗位表 `sys_post`

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `post_name` | 岗位名称 |
| `post_code` | 岗位编码，唯一 |
| `sort_order` | 排序 |
| `status` | 状态 |
| `remark` | 备注 |
| `created_by` / `created_at` | 创建信息 |
| `updated_by` / `updated_at` | 更新信息 |
| `deleted` | 逻辑删除 |

### 6. 关联表

```text
sys_user_role(user_id, role_id)
sys_user_post(user_id, post_id)
sys_role_menu(role_id, menu_id)
sys_role_dept(role_id, dept_id)
```

建议：

- 关联表设置联合唯一索引，避免重复授权。
- 删除用户、角色、菜单、部门时，需要同步清理关联表或通过业务逻辑限制删除。
- `sys_role_dept` 仅在角色 `data_scope = CUSTOM_DEPT` 时有效。
- 角色数据权限不是用户直接绑定部门，用户部门只表示用户归属，角色部门范围才表示可访问范围。

`sys_role_dept` 建议字段：

| 字段 | 说明 |
|------|------|
| `role_id` | 角色 ID |
| `dept_id` | 授权部门 ID |
| `include_children` | 是否包含子部门，首期可固定为 true |
| `created_at` | 创建时间 |

### 7. 配置与字典表

```text
sys_config
sys_dict_type
sys_dict_data
```

`sys_config` 关键字段：

- `config_name`
- `config_key`
- `config_value`
- `config_type`
- `builtin`
- `sensitive`
- `remark`

`sys_dict_type` 关键字段：

- `dict_name`
- `dict_code`
- `status`
- `remark`

`sys_dict_data` 关键字段：

- `dict_type_id`
- `label`
- `value`
- `sort_order`
- `status`
- `default_flag`

### 8. 日志表

```text
sys_login_log
sys_operation_log
sys_security_audit_log
```

日志表建议使用物理删除或定期归档，不建议逻辑删除所有历史日志。

---

## 六、接口规划

统一前缀：`/api`

### 1. 认证接口

```text
POST   /auth/login
POST   /auth/logout
POST   /auth/refresh-token
GET    /auth/me
GET    /auth/menus
GET    /auth/permissions
```

认证接口响应约定：

`POST /auth/login` 返回 Token 信息：

```json
{
  "accessToken": "access-token",
  "refreshToken": "refresh-token",
  "tokenType": "Bearer",
  "expiresIn": 7200
}
```

`GET /auth/me` 返回当前用户上下文：

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

`GET /auth/menus` 返回当前用户可访问的菜单树，只包含启用且授权的 `DIR` 和 `MENU`，按钮权限不放在菜单树中：

```json
[
  {
    "id": 1,
    "parentId": 0,
    "menuType": "DIR",
    "menuName": "系统管理",
    "path": "/system",
    "component": "Layout",
    "permissionCode": "",
    "icon": "settings",
    "visible": true,
    "keepAlive": false,
    "sortOrder": 1,
    "status": "ENABLED",
    "children": []
  }
]
```

`GET /auth/permissions` 返回当前用户按钮权限和接口权限标识：

```json
[
  "system:user:list",
  "system:user:add",
  "system:role:grant-menu"
]
```

### 2. 用户接口

```text
GET    /system/users
GET    /system/users/{id}
POST   /system/users
PUT    /system/users/{id}
DELETE /system/users/{id}
PATCH  /system/users/{id}/status
PATCH  /system/users/{id}/password
PUT    /system/users/{id}/roles
PUT    /system/users/{id}/posts
```

### 3. 角色接口

```text
GET    /system/roles
GET    /system/roles/{id}
POST   /system/roles
PUT    /system/roles/{id}
DELETE /system/roles/{id}
PATCH  /system/roles/{id}/status
GET    /system/roles/{id}/menus
PUT    /system/roles/{id}/menus
GET    /system/roles/{id}/data-scope
PUT    /system/roles/{id}/data-scope
GET    /system/roles/{id}/users
```

角色接口说明：

- `GET /system/roles` 支持按角色名称、角色编码、状态分页查询。
- `PUT /system/roles/{id}/menus` 请求体传菜单 ID 列表，后端整体替换角色功能权限。
- `PUT /system/roles/{id}/data-scope` 请求体传 `dataScope` 和 `deptIds`，后端按规则保存。
- `GET /system/roles/{id}/users` 用于删除角色前查看影响范围。

数据权限请求示例：

```json
{
  "dataScope": "CUSTOM_DEPT",
  "deptIds": [100, 101, 102]
}
```

角色权限码与前端按钮保持一致：

```text
system:role:list
system:role:add
system:role:edit
system:role:delete
system:role:grant-menu
system:role:grant-data
```

### 4. 菜单接口

```text
GET    /system/menus/tree
GET    /system/menus/{id}
POST   /system/menus
PUT    /system/menus/{id}
DELETE /system/menus/{id}
PATCH  /system/menus/{id}/status
```

### 5. 部门接口

```text
GET    /system/depts/tree
GET    /system/depts/{id}
POST   /system/depts
PUT    /system/depts/{id}
DELETE /system/depts/{id}
PATCH  /system/depts/{id}/status
```

### 6. 岗位、参数、字典、日志接口

```text
GET/POST/PUT/DELETE /system/posts
GET/POST/PUT/DELETE /system/configs
GET/POST/PUT/DELETE /system/dict-types
GET/POST/PUT/DELETE /system/dict-data
GET                 /system/login-logs
GET                 /system/operation-logs
GET                 /system/security-audit-logs
```

### 7. 前后端接口契约

接口响应继续使用现有统一结构：

```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

后端数据库字段使用 `snake_case`，接口 DTO 返回给前端时统一使用 `camelCase`。

字段映射示例：

| 数据库字段 | API 字段 |
|------------|----------|
| `parent_id` | `parentId` |
| `menu_type` | `menuType` |
| `menu_name` | `menuName` |
| `permission_code` | `permissionCode` |
| `keep_alive` | `keepAlive` |
| `sort_order` | `sortOrder` |
| `role_code` | `roleCode` |
| `data_scope` | `dataScope` |

通用枚举建议：

| 枚举 | API 值 |
|------|--------|
| 启用状态 | `ENABLED` |
| 禁用状态 | `DISABLED` |
| 菜单目录 | `DIR` |
| 菜单页面 | `MENU` |
| 菜单按钮 | `BUTTON` |

后端落库可以使用 tinyint 或 varchar，但 API 层必须保持上述字符串枚举，避免前端依赖数据库实现。

菜单 `component` 约定：

- 根布局使用 `Layout`。
- 普通页面使用相对 `views` 的组件路径，不带 `.vue` 后缀，例如 `system/user/UserView`。
- 外链菜单 `component` 可以为空。
- 后端只保存配置，前端通过白名单映射加载组件。

---

## 七、安全设计

### 1. 密码安全

- 密码只保存 BCrypt 哈希。
- 新增用户默认密码必须来自参数配置或管理员输入。
- 默认密码需要要求用户首次登录后修改，首期可预留字段 `force_password_change`。
- 修改密码、重置密码必须写安全审计日志。

### 2. Token 安全

- Access Token 短期有效。
- Refresh Token 长期有效但可撤销。
- Redis 保存当前有效会话。
- 登出、强退、修改密码后应使旧 Token 失效。

### 3. 接口安全

- 登录、刷新 Token、验证码、健康检查放行。
- 其他接口默认需要认证。
- 管理接口通过权限标识控制。
- 禁止仅依赖前端菜单隐藏实现权限控制。

### 4. 参数与日志安全

- 参数值中可能包含敏感信息时，接口返回必须脱敏。
- 日志中不得记录密码、Token、完整身份证号等敏感数据。
- 操作日志请求参数需要做长度限制，避免大字段撑爆日志表。

---

## 八、缓存设计

Redis 建议缓存：

- 用户会话：`auth:session:{tokenId}`
- Token 黑名单：`auth:blacklist:{tokenId}`
- 用户权限：`auth:permissions:{userId}`
- 用户菜单：`auth:menus:{userId}`
- 系统参数：`sys:config:{configKey}`
- 字典数据：`sys:dict:{dictCode}`

缓存失效规则：

- 修改用户角色后，清理该用户权限和菜单缓存。
- 修改角色菜单后，清理该角色相关用户的权限和菜单缓存。
- 修改菜单后，清理所有受影响用户的菜单缓存。
- 修改参数或字典后，清理对应 key。

首期可以先不做复杂缓存，只保留会话和验证码缓存；权限、菜单、参数、字典缓存可在接口稳定后补充。

---

## 九、实施顺序

建议分阶段落地，避免一次性铺太大。

### 阶段 1：基础设施

- 全局异常处理。
- 统一分页模型。
- 审计字段自动填充。
- MyBatis-Plus 基础配置。
- 数据库建表脚本。

### 阶段 2：核心 RBAC

- 用户、角色、菜单、部门表和 CRUD。
- 用户分配角色。
- 角色分配菜单。
- 当前用户菜单树和权限集合。

### 阶段 3：认证鉴权

- 登录、登出、刷新 Token。
- Spring Security JWT 过滤器。
- `@PreAuthorize` 权限校验。
- 在线用户和强退。

### 阶段 4：系统管理补齐

- 岗位管理。
- 参数管理。
- 字典管理。
- 登录日志、操作日志、安全审计日志。

### 阶段 5：数据权限

- 角色数据范围。
- 角色自定义部门范围。
- 列表查询接入数据权限过滤。
- 敏感管理动作补充安全审计。

---

## 十、首期最小可用范围

如果希望尽快跑通前后端，首期建议只做：

- `sys_user`
- `sys_role`
- `sys_menu`
- `sys_dept`
- `sys_user_role`
- `sys_role_menu`
- 登录认证
- 当前用户信息
- 当前用户菜单树
- 当前用户权限标识
- 用户、角色、菜单、部门基础 CRUD

暂缓：

- API 资源独立建模。
- 复杂数据权限拦截器。
- 通知公告。
- 文件管理。
- 多租户。
- 工作流。

这些能力在基础 RBAC 稳定后再加，风险更低。

---

## 十一、需要后续确认的问题

1. Token 方案是否采用 JWT + Redis 会话，还是纯 Redis Session。
2. 前端菜单是否完全动态路由，还是保留静态路由再做权限过滤。
3. 是否需要多租户。如果需要，多数核心表都要增加 `tenant_id`。
4. 数据权限首期是否必须上线，还是先预留字段后续实现。
5. 是否需要接口级权限资源表 `sys_api_resource`，或先使用注解权限标识。

默认建议：

- 首期使用 JWT + Redis 会话。
- 前端采用动态菜单和动态路由。
- 暂不做多租户。
- 数据权限先预留字段，第二阶段接入查询过滤。
- 接口权限先使用 `@PreAuthorize` + 菜单按钮权限标识，不单独建 API 资源表。
