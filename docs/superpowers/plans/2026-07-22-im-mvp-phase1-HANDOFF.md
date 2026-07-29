# IM 后端 MVP 第一阶段 — 执行交接文档

> 用途：在新会话继续执行《IM 后端 MVP 第一阶段实现计划》。读完本文即可从 **Task 7** 接手。
> 生成时间：2026-07-23。分支：`feat/im-mvp-phase1`。

## 1. 任务与计划

- **权威计划**：`docs/superpowers/plans/2026-07-22-im-mvp-phase1.md`（12 个 Task，里程碑 1~3）。
- **设计 spec**：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md`。
- **执行方式（用户明确要求）**：按 Task 1→12 顺序，**每个 Task 完成就 `git commit` + `git push`**；每个 Task 内严格走计划的 Step（含 TDD 失败→实现→通过）。
- 用 `superpowers:executing-plans` 技能驱动；全部做完后走 `superpowers:finishing-a-development-branch`。

## 2. 进度

| Task | 内容 | 状态 |
|------|------|------|
| 1 | Maven 多模块聚合 pom | ✅ 已提交推送 |
| 2 | compose 加 MongoDB + MinIO（profile im） | ✅ |
| 3 | im-gateway 网关模块骨架（可启动 + smoke test） | ✅ |
| 4 | IM 会话/成员/群 MySQL 表 + 实体 + Mapper（V3 迁移） | ✅ |
| 5 | MongoDB 消息文档 + 仓库（backend 接 mongo/kafka） | ✅ |
| 6 | 会话归一/成员服务 + Redis 定序服务 | ✅ |
| 7 | 网关↔logic 的 Kafka 消息契约（Envelope/OutboundPacket） | ⬜ **从这里继续** |
| 8 | 网关 JWT 校验器（复用 secret + Redis 会话存在性） | ⬜ |
| 9 | 本机连接表 + Redis 路由 | ⬜ |
| 10 | Netty WS 服务 + 握手鉴权 + 心跳 + InboundProducer | ⬜ |
| 11 | im-logic 入站消费 → 定序落库 → 出站投递 | ⬜ |
| 12 | 网关出站消费 → 推达在线连接（打通单聊文本闭环） | ⬜ |

最后提交：`e2be88f feat(im): 会话归一/成员服务与 Redis 定序服务`（`git log --oneline -8` 可核对）。

## 3. 环境（本地已就绪，新会话通常无需重搭）

Docker 容器均在跑（`cd deploy && docker compose ps` 核对）：
- `rbac-mysql`(3306)、`rbac-redis`(6379)：默认层，一直在跑。
- `rbac-mongodb`(27017)、`rbac-minio`(9000/9001)：`--profile im`，Task 2 起的。
- `rbac-kafka`(9092)：`--profile full`，Task 4 时为后续测试起的。

若需重起全部：`cd deploy && docker compose --profile im --profile full up -d`。

**关键：测试库 `rbac_test` 已手动创建并授权**（Flyway 只迁移不建库）。若换机器/重置需重建：
```bash
docker exec rbac-mysql mysql -uroot -prbac_root_123 -e \
  "CREATE DATABASE IF NOT EXISTS rbac_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; \
   GRANT ALL PRIVILEGES ON rbac_test.* TO 'rbac'@'%'; FLUSH PRIVILEGES;"
```
- backend 集成测试用 `@SpringBootTest @ActiveProfiles("test")`，连 `rbac_test`（MySQL）+ Redis db1 + mongo `rbac_im` + kafka。
- 主 `application.yml` 已加 `spring.data.mongodb.uri`、`spring.kafka.*`、`rbac.im.*`（Task 5）。

## 4. ⚠️ 收尾必做：恢复挪走的 WIP 测试

用户一个未跟踪的红灯测试编译不过，会挡 backend `mvn test`，**用户同意先挪走、收尾时恢复**。
- 原位置：`backend/src/test/java/com/rbac/system/role/RoleServiceCacheEvictTest.java`
- 现暂存：`/private/tmp/claude-501/-Users-xxmm-work-RBAC-Server/067b9987-e747-46ae-8cad-57fd55a883e4/scratchpad/wip-stash/role/`
- **若 scratchpad 已随会话清理丢失**：该测试内容见下（假设 `RoleService` 5 参构造含 `PermissionCacheService`、`grantMenus` 调 `cache.evictAll()`，生产代码尚未实现——它本就是红灯）。收尾时移回并提醒用户它仍未完成。
- 记忆已记：`~/.claude/projects/-Users-xxmm-work-RBAC-Server/memory/im-phase1-wip-stash.md`。

## 5. 执行约定 / 踩过的坑

- **commit 消息尾部必须带**两行：
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HXawi2et183C5A5Q6bDXQh
  ```
- **面向用户输出一律简体中文**（全局偏好）。
- **整仓构建别用 `mvn -pl backend -am`**：根 pom 列了 `im-gateway`，Maven 校验 `<modules>`，早期目录不全会报错。单模块构建用 `mvn -f <module>/pom.xml ...` 或整仓 `mvn ...`（im-gateway 已存在，现已 OK）。
- **`-DskipTests` 仍编译测试源**；要跳过坏测试编译用 `-Dmaven.test.skip=true`。
- **`.gitignore` 已改为通配 `target/`**（原来只写死 `backend/target/`）；提交前确认没混进 `*/target/**`。commit 时只 `git add` 本 Task 相关文件，别 `git add -A`（工作区有 docs 未跟踪文件与本 HANDOFF）。
- **mongo 测试要可重复**：cid_seq 唯一索引，测试开头先删本 cid 旧数据（见 `ImMessageRepositoryTest`）。
- 单模块跑测试：`mvn -pl backend -Dtest=XxxTest test` / `mvn -pl im-gateway -Dtest=XxxTest test`。im-gateway 不依赖 backend，互不牵连。

## 6. 关键契约（Task 7 要定义，10/11/12 依赖，两端字段必须一致）

- Kafka topics：`im-inbound`（key=cid）、`im-outbound`（key=gatewayId）。
- `Envelope{op(SEND/PUSH/ACK), cid, senderId, deviceId, clientMsgId, type, body(Map), seq, msgId, ts}`。
- `OutboundPacket{gatewayId, targetUserId, deviceId, envelope}`。
- backend 侧包 `com.rbac.im.protocol` + `com.rbac.im.config.ImKafkaTopics`；网关侧 `com.rbac.im.gateway.protocol` 复制**同字段**类（不共享 jar，各自 Jackson 序列化）。
- Redis key：`auth:access:<jti>`（已有，握手复用）、`im:conv:<cid>:seq`、`route:user:<userId>`（Hash: field=deviceId → value=gatewayId, TTL 120s 心跳续期）。
- 网关与 backend 共享 `rbac.jwt.secret`；网关鉴权 = 验签 + typ=access + 未过期 + Redis `hasKey("auth:access:"+jti)`。安全红线：登出（key 删）后旧 token 不能建连。

## 7. 新会话如何接手

1. `git checkout feat/im-mvp-phase1 && git log --oneline -6` 核对进度。
2. `cd deploy && docker compose ps` 确认中间件在跑（缺则按 §3 起）。
3. 打开计划文件，从 **Task 7 Step 1** 开始，逐 Task 实现→测试→commit+push（消息见计划各 Task 末尾，加 §5 尾部两行）。
4. 全部完成后：恢复 §4 的 WIP 测试 → `superpowers:finishing-a-development-branch`（可考虑开 PR）。
