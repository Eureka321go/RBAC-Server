# IM 客户端（React Native + 可移植 SDK）设计方案 — 子项目二

> 状态：已通过头脑风暴评审（2026-07-27）。定位：学习 / 简历作品。
> 上游：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md`（后端 MVP，里程碑 1~10 已完成）。
> 变更：原设计子项目二为 Flutter，本方案改为 **React Native（裸 RN CLI）**，并升级为**可移植 IM SDK**（core 纯 TS + 平台适配器），为将来 Electron 桌面端复用铺路。

## 背景（为什么做、做什么）

后端 IM MVP（Netty 网关 + im-logic + MongoDB + Kafka + Redis 路由）已跑通单聊/群聊/离线/富媒体/链接卡片/撤回/@提及/已读回执。本方案交付**移动端聊天客户端**，把后端"离线消息 = 多端同步 = 增量拉取"这套 seq 位点设计在客户端完整落地。

两个已确认的方向性诉求：
1. **可移植**：业务/同步逻辑做成零平台依赖的 TypeScript 核心（`im-sdk-core`），平台能力（数据库、长连接、安全存储、媒体选择、生命周期）通过接口注入。RN 是首个落地平台；**Electron 桌面端本期只定义接口、不建适配器包**，将来补一个适配器即可复用全部业务逻辑。
2. **同步引擎采用 SQLite 单一事实源（本地优先）**：WS 实时推与 REST 增量拉的数据一律先写 SQLite，UI 只从 SQLite 读；重连即 `pull(cid, sinceSeq=本地maxSeq)` 补齐。

**不做**（沿用后端边界）：音视频实时通话、消息编辑、朋友圈；本期不含推送通知（FCM/APNs）、不含落库加密（SQLCipher），均列为后续评估项。

对接接口以 `docs/10-IM接口文档.md` 为准（REST `:8080/api/im`，WebSocket `:9001/im`）。

---

## 技术栈（裸 RN CLI）

| 关注点 | 选型 | 理由 |
|------|------|------|
| 框架 | React Native CLI（裸工程） | 原生依赖无限制；自由度高 |
| 导航 | React Navigation（native-stack + 会话栈） | RN 事实标准 |
| 状态 | Zustand | 高频局部更新友好，无 Redux 样板 |
| 本地库 | op-sqlite（JSI） | 与后端 per-conversation seq 增量拉取契合；裸 RN 首选 |
| HTTP | axios | 复用 web 端拦截器 / 401 刷新约定 |
| 长连接 | RN 内置 WebSocket + 自写重连/心跳/退避封装 | 对齐网关 `?token=&deviceId=` |
| 聊天 UI | 自研 `FlatList inverted` 消息流（不用 gifted-chat） | 里程碑可解释、可控 |
| 媒体 | react-native-image-picker / document-picker + fetch 直传 | 对齐 `/im/upload/presign` |
| Token 存储 | react-native-keychain | 安全红线：token 不落明文 |
| core 测试 | vitest/jest + sql.js（WASM SQLite） | 纯 TS，Node 内跑，不依赖真机 |

---

## 总体架构：Ports & Adapters（六边形）

```
packages/
  im-sdk-core/          # 纯 TS：禁止 import react / react-native / node 内置模块
    protocol/           # Envelope、op、body 类型（对齐接口文档）
    engine/             # 同步引擎：seq 增量对账、乱序合并、撤回改写、幂等、已读位点
    store/              # 仓储层：只依赖 Database 接口，不 import 任何驱动
    ports/              # 平台能力接口定义（见下表）
    events/             # 框架无关 EventEmitter / 轻量 observable
  im-sdk-rn/            # RN 适配器：op-sqlite / RN WebSocket / keychain / image-picker / axios
  # im-sdk-electron/    # 本期不建；接口已在 core/ports 就位，将来补 better-sqlite3 / ws / safeStorage
  app-mobile/           # RN App：Zustand 订阅 core 事件，纯展示与交互
```

**核心原则**：`im-sdk-core` 只认接口、不认实现。core 中出现 `import 'op-sqlite'`、`import 'react'`、`import 'fs'` 之一即视为破坏可移植性（由 lint 规则 + 依赖边界检查守住）。

### 平台边界（ports）

| 能力 | 接口（core 定义） | RN 实现（本期） | Electron 实现（留接口） | 备注 |
|------|------------------|----------------|------------------------|------|
| 数据库 | `Database { exec, query, tx }`（全 Promise 化） | op-sqlite | better-sqlite3（主进程）/ 测试用 sql.js | SQL 方言与 schema 共享 |
| 长连接 | `Transport { connect, send, onMessage, onState, close }` | RN WebSocket | 渲染进程 WebSocket / 主进程 `ws` | header 不可设，靠 `?token=` 规避 |
| HTTP | `Http { get, post, put }` | axios | axios | — |
| 安全存储 | `SecureStore { get, set, del }` | react-native-keychain | Electron `safeStorage` | — |
| 媒体选择 | `MediaPicker { pickImage, pickFile }` | image-picker/document-picker | `dialog.showOpenDialog` | 上传走 fetch PUT，可移植 |
| 生命周期 | `AppLifecycle { onForeground, onBackground }` | `AppState` | BrowserWindow focus/blur | 回前台触发重连 + 补拉 |
| id/时间 | `Ids { uuid, now }` | 注入实现 | 注入实现 | Hermes 不保证 `crypto.randomUUID` |

### 同步引擎（SQLite 单一事实源）

- **写路径**：WS `PUSH` / REST `pull` 到达的消息 → 经引擎归一 → 写 SQLite（按 `(cid, seq)` 去重）→ 发"会话/消息变更"事件。
- **读路径**：UI 只从 SQLite 读；引擎事件驱动 UI 刷新（RN 侧用 Zustand 订阅）。
- **发送对账**：发送即以 `clientMsgId` 乐观写入（status=sending）；收到 `ACK` 标记已受理；收到自己的 `PUSH`（按 `clientMsgId` 匹配）回填 `seq/msgId/ts` 并置 status=sent；`ERROR` 帧置 status=failed 并冒泡原因。
- **增量补齐**：连接建立或回前台 → 对（活跃）会话 `GET /im/messages?cid=&sinceSeq=本地maxSeq`，按 `hasMore/nextSinceSeq` 翻页合并。
- **撤回改写**：收 `PUSH type=RECALL` → 将本地 `targetSeq` 行 `recalled=true` 且清正文。
- **已读位点**：本地维护 `last_read_seq`；单聊收对端 `READ` 回执更新 `peer_read_seq`。未读 = `last_msg_seq − last_read_seq`。

---

## 本地存储结构（SQLite，schema 跨端共享）

- `conversations(cid PK, type, group_id, last_msg_seq, last_msg_preview, last_read_seq, peer_read_seq, mention_seq, updated_at)`
- `messages(cid, seq, msg_id, client_msg_id, sender_id, type, body_json, recalled, status, ts, PRIMARY KEY(cid, seq))`；索引 `(cid, client_msg_id)` 供发送对账。
- `sync_meta(cid PK, synced_seq)` —— 本地已同步位点（= 本地 max seq）。
- 迁移：core 内置版本化迁移脚本（纯 SQL 字符串），适配器负责执行；同一套脚本在 op-sqlite / sql.js / better-sqlite3 上均可跑。

> `body_json` 存字符串，媒体消息的临时预签名 `url` 不落库（TTL 会过期），渲染时用最新 `pull`/`push` 带回的 url；仅持久化 `objectKey` 等稳定元数据。

---

## 客户端里程碑计划

每个里程碑落点：**逻辑进 `im-sdk-core`（Node + sql.js 单测）+ UI 进 `app-mobile`**；验收对已跑起来的 backend + im-gateway 做端到端。

1. **M0 · Monorepo 骨架与分层**：workspaces 三包；定义全部 ports 接口（Electron 实现留空）；SQLite schema + 迁移；事件总线；同步引擎壳。验收：core 用 sql.js 在 Node 跑通建表 + 假消息读写单测。
2. **M1 · 登录 + WS 长连接**：axios 复用 RBAC 登录拿 JWT → SecureStore；`ws://:9001/im?token=&deviceId=` + 心跳 + 退避重连；`AppLifecycle` 回前台强制重连。UI：登录页 + 连接状态条。验收：连上/断开、token 落 keychain。
3. **M2 · 单聊文本闭环**：`SEND` + clientMsgId 乐观写库 → `ACK` → 自己的 `PUSH` 对账回填；接收他人 `PUSH` 落库。UI：会话页（inverted FlatList）+ 输入栏。验收：A↔B 在线互发。
4. **M3 · 会话列表 + 离线/多端增量同步（引擎核心）**：`GET /im/conversations` 灌摘要与位点；连上/回前台按 `sinceSeq=本地maxSeq` 分页补拉合并；未读计算。UI：会话列表 + 未读红点。验收：离线重连补齐、第二设备一致。
5. **M4 · 群聊**：群管理 REST 全套（建/加/退/踢/改名/转让/角色/禁言/详情/成员）；`g_{groupId}` 渲染；`NOT_MEMBER/MUTED` 处理。验收：群发扇出收达。
6. **M5 · 富媒体（图片/音频/文件）**：`MediaPicker` → `POST /im/upload/presign` → fetch PUT 直传 → 发 IMAGE/AUDIO/FILE(objectKey+元数据)；预签名 GET url 渲染；上传进度/重试；媒体错误码全处理。验收：图片收发回环。
7. **M6 · 链接卡片**：body 带 link 字段渲染卡片；纯文本含 URL → 服务端异步补卡片 → 作为后续帧/拉取更新就地改写消息行。验收：发 URL 文本收到卡片。
8. **M7 · 撤回**：发 `RECALL{targetSeq}`；收 `PUSH type=RECALL` 改写本地行渲染"撤回了一条消息"；入口按 120s 窗口 / 本人或管理员显隐；`RECALL_*` 处理。验收：窗口内双端撤回、离线端上线收到。
9. **M8 · @提及**：TEXT 组装 `mentions/mentionAll` + @选择器；会话列表 `hasMention/mentionSeq` 强提醒读越过自动消除；`MENTION_*` 处理。验收：@成员提醒、非管理员@所有人被拒。
10. **M9 · 已读未读 + 已读回执**：阅读上报 `READ{readSeq}` + 本地 `last_read_seq`；单聊收对端 `READ` 回执 → `peer_read_seq` → 己方消息渲染"已读"。验收：单聊已读回执、未读消减。

**贯穿项（非独立里程碑）**：`ERROR` 帧统一处理、断线补偿、i18n / 主题（可选后置）。后端 M11 压测不属客户端范围。

---

## 错误处理

- **WS `ERROR` 帧**：core 统一解析 `body.reason`，映射为发送失败并冒泡给 UI（toast + 消息行 status=failed，可重发）。错误码集见接口文档 §4.6。
- **网络/连接**：Transport 状态机（connecting/connected/reconnecting/closed）通过 `onState` 暴露；退避重连（指数 + 抖动，上限封顶）；回前台强制重连。
- **REST 401**：axios 拦截器复用 RBAC 刷新单飞逻辑；刷新失败 → 回登录页。
- **媒体上传**：预签名过期 / PUT 失败 → 可重试；发送前对象不存在 → 后端回 `OBJECT_NOT_FOUND`，UI 提示重传。
- **幂等**：发送以 `clientMsgId` 去重；`PUSH`/`pull` 以 `(cid, seq)` 去重，扛 Kafka 重投与重连重复拉取。

---

## 测试策略

- **core（纯 TS，主战场）**：Node 内用 sql.js 实现 `Database`、用假 `Transport` 驱动，单测同步引擎：乱序合并、`clientMsgId` 对账、撤回改写、seq 去重幂等、未读/已读位点推进、增量拉取翻页合并。
- **适配器契约测试**：对 `im-sdk-rn` 的 op-sqlite `Database` 跑与 sql.js 相同的一组契约用例，抹平驱动差异（同步/异步、事务、`lastInsertRowid`）。
- **UI**：手动 e2e 对真后端（两用户/两设备场景，见验证方式）；Detox 自动化后置，不入本计划。

---

## 验证方式（端到端）

- 起中间件与服务：`cd deploy && docker compose --profile im --profile full up -d`；`mvn -f backend/pom.xml spring-boot:run`；`mvn -f im-gateway/pom.xml spring-boot:run`。
- 登录/连接：RN 登录拿 token → WS 握手成功 → 状态条显示已连接；杀后台再回前台自动重连。
- 单聊/离线：A↔B 在线互发；B 杀进程后 A 发，B 重启 `pull` 收到离线消息；B 第二设备登录增量同步一致。
- 富媒体：选图 → 预签名 → 直传 → 发送 → 对端拉取预签名 GET 回显。
- 撤回/@/已读：窗口内撤回双端渲染；群里 @成员出现强提醒读后消除；单聊已读回执显示"已读"。

---

## 已决策

- 裸 RN CLI；同步引擎 SQLite 单一事实源（方案 A）。
- 可移植 SDK：`im-sdk-core`（纯 TS）+ `im-sdk-rn`（适配器）+ `app-mobile`；Electron **本期只定义 ports 接口、不建适配器包**。
- 本期不含推送通知与落库加密，列为后续评估。
- 里程碑对齐后端已完成功能递进（M0 骨架 → M9 已读）。

---

## 后续（不在本方案）

- Electron 桌面端适配器包（better-sqlite3 主进程 + IPC 桥接 UI）。
- 推送通知（FCM/APNs）、落库加密（SQLCipher）、图片缩略图。
- Detox 端到端自动化、CI 构建产物。
