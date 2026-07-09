# RBAC-Server

专业的 RBAC 权限管理系统，前后端同仓（monorepo，目录隔离）。覆盖用户 / 角色 / 菜单 / 部门 / 岗位 / 参数 / 字典 / 日志全套后台管理，内置数据权限、JWT 鉴权、中英双语国际化与明暗主题切换。

## ✨ 特性

- **三层权限模型**：Spring Security 登录判定 → `@PreAuthorize` 权限标识 → Service 层业务二次校验（禁止删超管、禁止改自身最高角色等）。
- **动态路由 + 按钮权限**：后端菜单生成前端路由，`v-permission` / `PermissionButton` 控制按钮级权限。
- **数据权限**：`DataScope`（全部 / 自定义部门 / 本部门及子部门 / 本部门 / 仅本人）在 Service 层显式接入，列表接口不可绕过。
- **JWT 双 Token**：Access + Refresh，401 刷新单飞重放，登出 / 改密 / 强退后旧 Token 立即失效。
- **国际化（中 / 英）**：前端 vue-i18n，后端 `MessageSource` 按 `Accept-Language` 返回本地化异常与校验消息。
- **主题切换**：浅色 / 深色 / 跟随系统，主题色可调，语义化 CSS 变量 + 防 FOUC。

## 🧱 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Java 21 · Spring Boot 3.4.1 · Spring Security · MyBatis-Plus 3.5.9 · MySQL 8.4 · Redis 7.4（Lettuce）· Maven |
| 前端 | Vue 3.5（Composition API）· TypeScript · Vite · Pinia · Vue Router · Element Plus · Tailwind 4 · axios · vue-i18n |
| 中间件 | Docker Compose（MySQL + Redis） |

## 📁 目录结构

```
RBAC-Server/
├── backend/      Spring Boot 后端（com.rbac.{auth,common,security,system.*}）
├── frontend/     Vue 3 前端（views / stores / api / locales / layouts）
├── deploy/       docker-compose.yml + 中间件配置
├── docs/         设计文档（环境搭建 / RBAC 设计 / i18n / 主题 等）
└── CLAUDE.md     项目约定与开发规范
```

## 🚀 快速开始

### 1. 启动中间件（MySQL + Redis）

```bash
cd deploy && docker compose up -d
```

### 2. 启动后端

```bash
mvn -f backend/pom.xml spring-boot:run
```

服务地址：`http://localhost:8080/api`（context-path `/api`）。首次启动自动执行 `schema.sql` / `data.sql`（幂等）。

### 3. 启动前端

```bash
cd frontend && npm install && npm run dev
```

默认账号：`admin` / `admin123`。

## 🛠 常用命令

| 用途 | 命令 |
|------|------|
| 起中间件 | `cd deploy && docker compose up -d` |
| 后端运行 | `mvn -f backend/pom.xml spring-boot:run` |
| 后端构建 | `mvn -f backend/pom.xml package` |
| 后端测试 | `mvn -f backend/pom.xml test` |
| 前端开发 | `cd frontend && npm run dev` |
| 前端类型检查 | `cd frontend && npm run type-check` |
| 前端 lint | `cd frontend && npm run lint` |
| 前端构建 | `cd frontend && npm run build` |

## 📐 约定要点

- **API 契约**：DB 用 snake_case，API 统一 camelCase；枚举固定字符串（状态 `ENABLED`/`DISABLED`，菜单类型 `DIR`/`MENU`/`BUTTON`）；统一前缀 `/api`。
- **统一响应**：`Result<T> {code,message,data}`；分页 `PageRequest` / `PageResult`；`BusinessException` + `GlobalExceptionHandler`。
- **实体基类**：`BaseEntity`（id / createdBy / createdAt / updatedBy / updatedAt / deleted），逻辑删除 `@TableLogic`。
- **国际化**：后端文案集中在 `backend/src/main/resources/i18n/messages*.properties`，前端在 `frontend/src/locales/{zh-CN,en-US}.ts`。

## 🔒 安全红线

- 前端隐藏仅为体验，敏感操作后端必须再鉴权。
- 数据权限（`dept_id` / `created_by` 过滤）不可绕过、不可漏接列表接口。
- 日志 / 参数返回禁止出现密码、Token、完整身份证；操作日志参数需限长。
- `application.yml`、`deploy/.env` 中密码仅限本地，勿带入生产（JWT 密钥用环境变量覆盖）。

## 📚 文档

详见 [`docs/`](docs/)：环境搭建、后端骨架、前后端分离、RBAC 后端设计、前端 RBAC 方案、工作流审批、国际化、主题切换。
