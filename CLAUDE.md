# RBAC-Server

专业 RBAC 权限管理系统，monorepo（前后端同仓、目录隔离）。设计文档见 `docs/`，
开发严格按 `docs/04-RBAC后端设计.md`、`docs/05-前端RBAC设计方案.md` 的分阶段实施顺序推进。

## 技术栈
- 后端 `backend/`：Java 21 + Spring Boot 3.4.1 + Spring Security + MyBatis-Plus 3.5.9（**非 JPA**）+ MySQL 8.4 + Redis 7.4（Lettuce）。Maven 构建。
- 前端 `frontend/`：Vue 3.5（Composition API）+ TypeScript + Vite 8 + Pinia + Vue Router 5 + Element Plus + Tailwind 4 + axios。
- 中间件：`deploy/docker-compose.yml`（分层 profile，默认起 MySQL+Redis）。

## 常用命令
| 用途 | 命令 |
|------|------|
| 起中间件 | `cd deploy && docker compose up -d` |
| 后端运行 | `mvn -f backend/pom.xml spring-boot:run`（:8080，context-path `/api`） |
| 后端构建 | `mvn -f backend/pom.xml package` |
| 后端测试 | `mvn -f backend/pom.xml test` |
| 前端开发 | `cd frontend && npm run dev` |
| 前端类型检查 | `cd frontend && npm run type-check` |
| 前端 lint | `cd frontend && npm run lint` |

## 后端约定
- 包结构：`com.rbac.{auth, common, security, system.{user,role,menu,dept,post,config,dict,log,notice}}`；每模块内 `controller/service/mapper/entity/dto/vo`。
- 统一响应 `Result<T> {code,message,data}`；统一分页 `PageRequest/PageResult`；`BusinessException` + `GlobalExceptionHandler`。
- `BaseEntity`：id/createdBy/createdAt/updatedBy/updatedAt/deleted（逻辑删除 `@TableLogic`，deleted 0/1）。
- 鉴权三层：Spring Security 登录判定 → `@PreAuthorize('hasAuthority(...)')` 权限标识 → Service 层业务二次校验（禁止删超管、禁止改自身最高角色等）。
- 数据权限在 Service 层显式接入（`DataScopeContext/Service/Query`），暂不用 MyBatis 拦截器。

## 前端约定
- 三层权限：token 登录态 → 动态路由（后端菜单生成）→ 按钮权限（`v-permission` / `PermissionButton`，权限码 Set）。
- 后端菜单 component 走 `import.meta.glob` 白名单映射，**禁止直接执行后端返回路径**；`Layout` 为根布局。
- 401 刷新 Token 单飞、重放；403 不重试、直接提示无权限。

## API 契约
- DB 用 snake_case，API 统一 camelCase（parentId/menuType/permissionCode/keepAlive/sortOrder/roleCode/dataScope…）。
- 枚举固定字符串：状态 `ENABLED`/`DISABLED`，菜单类型 `DIR`/`MENU`/`BUTTON`。落库可 tinyint/varchar，但 API 层必须是上述字符串。
- 统一前缀 `/api`。

## 安全红线
- 前端隐藏只是体验，敏感操作后端必须再鉴权。
- 数据权限（dept_id/created_by 过滤）不可绕过、不可漏接列表接口。
- 登出/改密/强退后旧 Token 必须失效。
- 日志/参数返回禁止出现密码、Token、完整身份证；操作日志参数需限长。
- `application.yml`、`deploy/.env` 中密码仅限本地，勿带入生产。

## ECC skills（本项目建议）
- 日常：`ecc:plan`、`ecc:feature-dev`、`ecc:orch-add-feature`、`ecc:code-review`、`ecc:git-workflow`
- 后端：`ecc:springboot-patterns`、`ecc:springboot-security`、`ecc:springboot-tdd`、`ecc:java-coding-standards`、`ecc:mysql-patterns`、`ecc:redis-patterns`、`ecc:api-design`
- 前端：`ecc:vue-patterns`、`/ecc:vue-review`、`ecc:vite-patterns`、`ecc:frontend-patterns`、`ecc:frontend-a11y`
- UI/设计（后台管理，重一致清晰、轻动效）：`ecc:design-system`、`ecc:ui-to-vue`、`ecc:frontend-design-direction`、`ecc:make-interfaces-feel-better`、`ecc:accessibility`；Dashboard 图表用内置 `dataviz`（画图前必读）。按需：`ecc:motion-ui`、`ecc:gan-design`、`ecc:ui-demo`、`ecc:taste`。
- 安全：`ecc:security-review`、`ecc:security-scan`
- 辅助：`ecc:update-codemaps`、`ecc:update-docs`、`ecc:test-coverage`
- 注意：用 MyBatis-Plus，不适用 `ecc:jpa-patterns`。
