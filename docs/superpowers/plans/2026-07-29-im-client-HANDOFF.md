---
meta:
  contentType: Reference
---

# 如何在新窗口继续开发 IM 前端

本文记录 `feat/im` 分支在 2026-07-29 的可运行状态。新窗口可直接继续开发，不需要重新梳理单聊、离线同步和双模拟器环境。用户已完成本轮手动测试，并确认测试结果正常。

## 协作与提交约定

- 后续 Git 提交标题和开发记录统一使用中文。
- 提交前先检查差异并完成与改动范围相符的静态验证。
- 只提交到本地分支，不主动 push。
- IM 客户端全局视觉改造已由用户在 2026-07-29 手动验收通过。

## 当前接手点

当前工作区在 `/Users/xxmm/work/RBAC-Server`，分支为 `feat/im`。消息撤回客户端代码完成时的提交为 `f431284`，网关撤回转发修复为 `d30e65c`。所有改动只保存在本地分支，未主动 push。

本轮已完成以下功能：

- React Native 登录、登录态恢复、WebSocket 自动连接与状态展示
- 会话列表、本地快照、离线分页同步、下拉刷新与前台自动同步
- 新建单聊、单聊成员关系创建、聊天页文本收发与失败重发
- 消息发送状态收敛，包括 `OFFLINE`、`ACK_TIMEOUT` 与 `PUSH_TIMEOUT`
- 已发送消息与待发送消息按时间合并排序
- 会话列表显示真实对端名称，不再统一显示“用户”
- 消息页显示当前账号名称与首字头像
- Android 安全区、连接状态栏和聊天页顶部样式调整
- 网关心跳续期在线路由，避免路由的 Redis 生存时间到期
- 每次安装独立且跨账号保留的 deviceId
- 单聊已读上报、对端已读回执和本地位点前向合并
- 建群、群聊、群名称、群成员和角色管理
- 统一移动端蓝白视觉与消息/联系人头像
- 长按消息气泡撤回、实时/离线撤回同步和中文错误提示
- 应用从后台回到前台时立即发送心跳，恢复可能已经过期的 Redis 在线路由
- 网关将 `RECALL` 请求转发到后端消息链路

关键提交如下：

| 提交 | 内容 |
| --- | --- |
| `d30e65c` | 转发消息撤回请求 |
| `62ef0ee` | 前台恢复时立即续期在线路由 |
| `f431284` | 支持长按撤回消息 |
| `da452b8` | 禁止本地保存已撤回正文 |
| `7b3b538` | 新增消息操作面板 |
| `79fefb8` | 接入撤回请求、结果事件和确认超时 |
| `a0e835f` | 协调 SQLite 撤回控制消息与目标消息 |
| `4f2b733` | 接入单聊已读回执 |
| `4034ddf` | 持久化每次安装独立 deviceId |
| `cc6acce` | 按时间排列待发送与已发送消息 |
| `7c332a1` | 会话列表显示对端用户名称 |
| `bf96241` | 续期在线路由并终止超时发送状态 |
| `d6abcf1` | 创建单聊成员关系并修复聊天页顶部样式 |
| `192efda` | 增加用户头像消息头并修复顶部安全区 |
| `c24a2cf` | 切换账号前隔离本地消息缓存 |
| `67910e3` | 增加会话列表与离线刷新交互 |
| `eb8690a` | 装配连接与前台自动同步 |
| `4829bbc` | 增加离线分页同步服务 |
| `75e5584` | 增加本地会话快照读写 |

旧计划中的复选框没有随实现更新。判断完成状态时，以提交历史和当前代码为准，不要以计划文件中的未勾选项为准。

## 前端结构与数据流

`im-client` 是 npm workspace，包含三个包：

- `packages/im-sdk-core`：纯 TypeScript 核心层，负责协议、连接、聊天、同步和本地存储接口
- `packages/im-sdk-rn`：React Native 适配层，接入 Axios、WebSocket、Keychain、AppState 和 op-sqlite
- `packages/app-mobile`：React Native 0.86 应用，负责页面、导航和 Zustand 状态

主要页面和入口如下：

- `im-client/packages/app-mobile/App.tsx`：应用启动、登录恢复和导航
- `src/screens/LoginScreen.tsx`：登录
- `src/screens/ConversationsScreen.tsx`：会话列表和当前用户信息
- `src/screens/ContactsScreen.tsx`：选择用户并创建单聊
- `src/screens/ChatScreen.tsx`：聊天、发送状态和重发
- `src/components/ConnectionStatusBar.tsx`：顶部连接状态安全区
- `src/components/CompactScreenHeader.tsx`：聊天页紧凑标题栏
- `src/sdk.ts`：服务地址和 SDK 装配
- `src/store.ts`：应用状态与账号切换清理

SQLite 是消息与会话的界面数据源。WebSocket 推送和 REST 同步先写入本地存储，再通过事件通知页面刷新。聊天页合并已落库消息与 outbox 消息，并按时间排序。

发送链路如下：

1. `sendText` 生成 `clientMsgId`，向 outbox 写入 `sending`
2. 网关返回 `ACK` 后，状态改为 `acked`
3. 服务端返回自己的最终 `PUSH` 后，消息写入本地消息表并删除 outbox 行
4. 15s 内没有 `ACK` 时，状态改为 `ACK_TIMEOUT`
5. 收到 `ACK` 后 30s 内没有最终 `PUSH` 时，状态改为 `PUSH_TIMEOUT`
6. 点击红色 `!` 时，客户端复用原 `clientMsgId` 重发

## 启动完整联调环境

先在四个终端启动依赖、后端、网关和 Metro。依赖首次安装时，在 `im-client` 目录执行 `npm install`。

终端一启动中间件：

```bash
cd /Users/xxmm/work/RBAC-Server/deploy
docker compose --profile im --profile full up -d
```

终端二启动 REST 后端：

```bash
cd /Users/xxmm/work/RBAC-Server
mvn -f backend/pom.xml spring-boot:run
```

终端三启动即时通信网关：

```bash
cd /Users/xxmm/work/RBAC-Server
mvn -f im-gateway/pom.xml spring-boot:run
```

终端四启动 Metro。两个模拟器共用这一个 Metro 进程：

```bash
cd /Users/xxmm/work/RBAC-Server/im-client/packages/app-mobile
npm start
```

Android 模拟器通过 `10.0.2.2` 访问宿主机。当前客户端连接 `http://10.0.2.2:8080/api` 和 `ws://10.0.2.2:9001/im`，配置位于 `im-client/packages/app-mobile/src/sdk.ts`。

## 启动两个 Android 模拟器

本机 zsh 已配置两个命令。它们属于本机配置，不在 Git 仓库中：

- `adp`：启动原有 `Pixel_9`，通常对应 `emulator-5554`
- `adp2`：启动低内存 `IM_Peer_Lite`，通常对应 `emulator-5556`

`IM_Peer_Lite` 使用 Android 30 AOSP ARM64、720 × 1280、2 核和 2 GB 内存，并关闭音频、摄像头与开机动画。

启动第二台模拟器并安装应用：

```bash
adp2
cd /Users/xxmm/work/RBAC-Server/im-client/packages/app-mobile
adb -s emulator-5556 reverse tcp:8081 tcp:8081
npm run android -- --deviceId emulator-5556 --no-packager
```

启动原模拟器并安装应用：

```bash
adp
cd /Users/xxmm/work/RBAC-Server/im-client/packages/app-mobile
adb -s emulator-5554 reverse tcp:8081 tcp:8081
npm run android -- --deviceId emulator-5554 --no-packager
```

如果端口编号变化，先执行 `adb devices`，再把命令中的序列号替换为实际值。不要为第二台模拟器再启动一个 Metro。

## 本轮验证状态

用户已在 2026-07-29 完成本轮手动测试，并确认测试全部正常。本轮重点覆盖了双账号单聊、真实用户名、消息顺序、失败状态收敛、重新发送和页面顶部样式。

后续排查发现：应用在后台超过 Redis 在线路由的 120 秒生存时间后，React Native 的心跳定时器可能暂停，但 WebSocket 仍保留 `connected` 状态。此时消息能到达后端并落库，网关也能收到出站事件，却因用户路由已过期而无法下发最终 `PUSH`，界面会停留在 `acked` 转圈状态。`62ef0ee` 已在前台恢复时立即重启心跳并发送 `PING`，让紧随其后的 `SEND` 之前先重建路由。该修复尚待用户按下文步骤手动验证。

开发过程中曾使用以下静态或编译检查。用户明确要求后续功能开发不新增或代跑测试，因此新窗口只需说明建议手测项，由用户执行：

```bash
cd /Users/xxmm/work/RBAC-Server/im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
```

```bash
cd /Users/xxmm/work/RBAC-Server
mvn -f backend/pom.xml -Dmaven.test.skip=true clean package
mvn -f im-gateway/pom.xml -Dmaven.test.skip=true package
```

## 下一窗口优先处理的边界

用户确认按以下顺序继续补齐客户端消息能力：

1. 消息撤回：代码已完成，等待用户手动验收。
2. @ 提及：下一项开发目标。
3. 图片、语音、文件等富媒体消息。
4. 链接卡片。

消息撤回的设计和实施记录位于：

- `docs/superpowers/specs/2026-07-29-im-client-recall-design.md`
- `docs/superpowers/plans/2026-07-29-im-client-recall.md`

撤回手测需要覆盖：单聊本人、单聊他人、群成员本人、群管理员撤回他人、普通成员撤回他人、超过 120 秒、双设备实时、离线重连、重复/断线/服务端拒绝、会话摘要共十类场景。

手测前需要重启 `im-gateway`，使 `d30e65c` 的 `RECALL` 转发逻辑生效；同时重新加载或重启客户端，使 `62ef0ee` 的前台心跳修复生效。在线路由修复可将双方应用置于后台超过 2 分钟，再打开发送方并立即发消息，确认发送状态完成且接收方收到消息。

## 已知限制

继续开发前需保留以下上下文：

- 当前移动端已完整接入单聊文本、群聊文本、已读回执和消息撤回。
- 服务端已具备富媒体、链接卡片和 @ 提及能力，但移动端尚未接入这些界面与事件。
- `PUSH_TIMEOUT` 后直接复用原 `clientMsgId` 重发存在边界：如果服务端已落库但最终 `PUSH` 丢失，服务端幂等分支可能只确认重复请求，不会重新推送已存消息
- 上述边界发生后，重新进入会话并执行 REST 同步可以恢复已落库消息；长期修复应让服务端重复请求重新投递既有消息，或让客户端超时后主动同步会话
- 账号切换会清理本地消息，避免不同账号共用 SQLite 数据；不要移除这段清理逻辑
- `adp2`、新建的 Android Virtual Device 和 Android 30 系统镜像只存在于当前开发机

## 新窗口可直接使用的开场指令

将下面内容粘贴到新窗口：

```text
继续开发 IM 前端。先完整阅读：
docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md

当前分支是 feat/im。用户已手动验证上一轮功能，测试都正常。
不要新增或运行测试；每完成一项功能，只告诉我需要手测哪些场景。
先检查工作区和最近提交，再从交接文档的“下一窗口优先处理的边界”继续。
先让用户手动验收消息撤回；验收通过后开始设计和实现 @ 提及。
修改完成后先查看 git diff，再提交代码，不要主动 push。
```
