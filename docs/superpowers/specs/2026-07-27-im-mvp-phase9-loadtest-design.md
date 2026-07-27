# IM 后端 MVP · 第九阶段（里程碑11：压测客户端 + 方案 + 观测清单）设计

- Base（起点）：`fb9e422`（里程碑10 已读未读 完成点）
- 分支：`feat/im`（长期集成分支）
- 总设计：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` §「分阶段实施里程碑」第 11 项
- 执行方式：本会话内实现（docs/scaffold 为主，可单测的部件 TDD）

## 决策（用户已定 2026-07-27）

1. **新建 Maven 模块 `im-loadtest`**（根 `pom.xml` 子模块，与 `backend`/`im-gateway` 平级），不塞进 im-gateway 的 test 目录。
2. **Token 用 mint+seed 为主**：压测客户端用共享 `rbac.jwt.secret` 自签 access JWT，并往 Redis 写 `auth:access:<jti>` 键绕过真登录（免预置 N 个用户）。真登录（`POST /api/auth/login`）作为备选路径在方案文档说明，不写进客户端代码。
3. **暂不真跑**：本期交付「压测客户端 + 压测方案文档 + 观测指标清单」，不拉起全套基建实际压测。WebSocket 驱动循环为集成级、需活网关，文档标注手动验证，不强行单测。

## 协议现状（压测客户端据此对话，勿改网关）

- **握手**：`ws://<host>:9001/im?token=<JWT>&deviceId=<id>`（`im.gateway.ws-port=9001`）。`HandshakeAuthHandler` 在 WS 升级前读 `token`/`deviceId`，`GatewayJwtVerifier` 校验：① jjwt 验签（HMAC-SHA，`rbac.jwt.secret`）；② claim `typ=="access"`；③ **Redis `auth:access:<jti>` 键必须存在**（`StringRedisTemplate.hasKey`，只判存在、不反序列化值）。任一不过 → 401 关闭。
- **JWT claims**（照 `JwtTokenProvider.createToken`）：`id=jti`、`subject=String.valueOf(userId)`、`username`、`typ="access"`、`iat`、`exp`，`signWith(HMAC key)`。
- **上行**：连接后发 `TextWebSocketFrame` JSON `Envelope`：`{op:"SEND", cid, clientMsgId, type:"TEXT", body:{text:"..."}}`。`senderId`/`deviceId` 由网关按连接身份覆盖（客户端伪造无效）。
- **下行**：
  - `ACK`：网关收到 SEND 立即回，`{op:"ACK", clientMsgId}`（不带 seq）。
  - `PUSH`：消息扇出到该用户时收到，`{op:"PUSH", cid, senderId, type, body, seq, msgId, ts, clientMsgId}`。
- **Envelope 字段**（与 `com.rbac.im.protocol.Envelope` 一致）：`op/cid/senderId/deviceId/clientMsgId/type/body/seq/msgId/ts`。

## mint+seed 细节（客户端核心）

- **自签**：jjwt `Jwts.builder().id(jti).subject(userId).claim("username", u).claim("typ","access").issuedAt(now).expiration(now+ttl).signWith(key).compact()`，`key = Keys.hmacShaKeyFor(secret.getBytes(UTF_8))`。secret 与 backend/gateway 同值（配置传入）。
- **seed**：对每个 jti，Redis `SET auth:access:<jti> "1" EX <ttlSeconds>`（值任意，网关只判存在）。用纯字符串 key（与网关 `StringRedisTemplate` 一致）。
- **teardown**：压测后 `DEL auth:access:<jti>`（清理注入的会话键）。
- **注意**：seed 只保证网关握手过；消息真正落库/扇出还需 backend(im-logic) 侧会话与成员存在。方案文档说明「压测前用直插会话/成员数据或走建会话接口预置 cid + 成员」的前置步骤。

## 模块结构 `im-loadtest/`

纯 Java CLI，依赖 jjwt（自签）、jackson（Envelope JSON）、Lettuce 或 jedis（seed Redis；复用 spring-data-redis 或直接 Lettuce）。WebSocket 用 **JDK 内置 `java.net.http.WebSocket`（零新 WS 依赖）**。

- `LoadTestConfig`：解析 CLI/属性——`host, wsPort, redisHost, redisPort, secret, connections, durationSeconds, sendRatePerConnPerSec, userIdBase, ttlSeconds, reportPath`。
- `TokenMinter`：`mint(userId) -> (jti, token)`，同 secret 自签 access JWT。**可 TDD**：mint 出的 token 能被同 secret 的 jjwt parser 解回，claims（sub/typ/jti/exp）正确。
- `SessionSeeder`：`seed(jti, ttl)` / `unseed(jti)` 写/删 `auth:access:<jti>`。**可 TDD**（用嵌入式/本地 Redis 或 mock 抽象接口断言 key 格式与 TTL）。
- `EnvelopeCodec`：build SEND / parse 收到帧（ACK/PUSH）。**可 TDD**：SEND 序列化字段正确、PUSH/ACK 反序列化取 op/clientMsgId/seq/ts。
- `LatencyStats`：记录延迟样本，算 p50/p90/p99/max/mean、count。**可 TDD**：已知样本集分位数正确、空集不崩。
- `Metrics`：聚合 sent/received/ackCount/pushCount/errors/timeouts + 两类延迟（ACK 延迟、端到端投递延迟，按 clientMsgId 配对 sender SEND ts → receiver PUSH 收到时刻）。**可 TDD**：配对逻辑与计数。
- `WsLoadRunner`：并发建 N 连接、按 QPS 发送、收帧回填指标、到时停。**集成级**（需活网关，不单测）。
- `ReportWriter`：输出控制台摘要 + 落地 `report-<ts>.md`（连接成功率、总吞吐 msg/s、ACK 延迟分位、端到端延迟分位、错误/超时/掉线）。**可 TDD**：给定 Metrics 快照渲染出含关键字段的 markdown。
- `LoadTestMain`：`main` 编排——mint+seed N 用户 → 起 runner → 收集 → 写报告 → teardown。集成级。

## 压测方案文档（本 spec 同文件的「压测方案」章节 + 观测清单，落地为模块 README）

- **场景**：① 连接爬坡（1k→5k→N，观察建连成功率/网关内存）；② 稳态 QPS（固定连接数，逐档提发送速率，找拐点）；③ 尖峰（瞬时打满，观察恢复）。
- **目标阈值**（示例，压测时校准）：建连成功率 ≥99.9%；端到端 p99 投递延迟 <500ms（本机基线，仅代表本机环境）；无消息丢失（sent==received 配对率）。
- **前置**：起 `deploy/docker-compose`（MySQL+Redis+Kafka+Mongo）→ 起 backend(im-logic) → 起 im-gateway → 预置 cid + 成员（直插或建会话接口）。
- **跑法**：`java -jar im-loadtest.jar --host=... --connections=... --duration=... --rate=... --secret=...`。
- **判读**：各跳延迟归因（ACK 延迟=网关往返；端到端-ACK≈Kafka+logic+持久化+回程）。

## 观测指标清单（并入文档）

- **网关**：活跃连接数、accept/close 速率、Netty 内存/直接内存、JVM 堆/GC 停顿。
- **Kafka**：`im-inbound`/`im-out` 生产/消费速率、消费者组 lag。
- **im-logic**：消费吞吐、append 耗时、Mongo 写延迟/连接池、Redis 路由 ops。
- **MySQL**：会话/成员表 QPS（本期已读/未读推进走 UPDATE）。
- **压测客户端侧**：sent/received、ACK/端到端延迟分位、错误率。

## 测试（TDD 可覆盖部分，其余集成级手动）

- `TokenMinterTest`：mint 的 token 被同 secret jjwt parser 解回，`sub/typ=access/jti/exp` 正确；错 secret 解不开。
- `SessionSeederTest`：seed 写出 key `auth:access:<jti>`、带 TTL；unseed 删除。（对 Redis 操作抽象成接口，测断言调用与 key 格式；或用本地 Redis。）
- `EnvelopeCodecTest`：SEND 序列化字段齐全；ACK/PUSH 反序列化取值正确。
- `LatencyStatsTest`：已知样本分位数正确、空集返回 0/不崩。
- `MetricsTest`：SEND→PUSH 按 clientMsgId 配对算端到端延迟；ACK 计数；未配对不误计。
- `ReportWriterTest`：给定 Metrics 快照渲染 markdown 含关键字段。
- `WsLoadRunner`/`LoadTestMain`：**集成级**，需活网关，文档标注手动验证步骤，不写自动化单测。

## YAGNI 裁掉

不做多机分布式压测协调、不做实时 Grafana/Prometheus 面板接线（清单文字描述即可）、不做 GUI、不做真登录模式的客户端代码（仅文档备选）。

## 里程碑收尾

里程碑 11 完成后，IM MVP 全部 11 个里程碑达成，`feat/im` 可用 `superpowers:finishing-a-development-branch` 收尾（合 main / 开 PR，用户定）。
