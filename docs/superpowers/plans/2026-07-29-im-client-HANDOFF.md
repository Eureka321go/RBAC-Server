---
meta:
  contentType: Reference
---

# 如何在新窗口继续开发 IM 前端

本文记录 `feat/im` 分支截至 2026-07-30 的可运行状态。新窗口可直接继续开发，不需要重新梳理单聊、离线同步和双模拟器环境。语音消息与链接卡片已由用户手动验收通过；消息引用代码已完成，等待用户手动验收。

## 协作与提交约定

- 后续 Git 提交标题和开发记录统一使用中文。
- 提交前先检查差异并完成与改动范围相符的静态验证。
- 只提交到本地分支，不主动 push。
- IM 客户端全局视觉改造已由用户在 2026-07-29 手动验收通过。

## 当前接手点

当前工作区在 `/Users/xxmm/work/RBAC-Server`，分支为 `feat/im`。本轮消息引用提交未主动 push。工作区另有用户自己的 `backend/src/main/java/com/rbac/im/entity/ImConversationMember.java` 与 `backend/src/main/java/com/rbac/im/service/ConversationService.java` 改动，本轮提交未包含也未覆盖它们。

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
- 群聊输入 `@` 后按名称搜索并多选成员，自动排除本人和已提及成员
- 群主、管理员可发送与普通成员提及互斥的 `@所有人`
- 提及正文、成员 ID 与 UTF-16 范围结构化写入 outbox，失败重发保留原始语义
- 实时、离线和本地待发送消息统一安全校验并高亮提及片段
- 群成员加载失败、成员已退群和 `@所有人` 越权均显示中文提示
- 对端消息使用白色气泡，己方消息使用较深的淡绿色 `#D5F0E2`
- 消息正文统一使用黑色，合法的 `@成员` 与 `@所有人` 使用浅蓝色 `#5B8DEF`
- 图片支持拍照或相册选择、最长边 2048/质量 0.8 压缩、上传进度、失败重试和取消
- 文件支持系统文档选择、上传进度、失败重试、下载进度和调用系统应用打开
- 小于 5 MiB 的媒体复用单次预签名 PUT，达到 5 MiB 后走 S3 Multipart Upload
- Multipart 会话和客户端上传任务分别持久化到 MySQL 与 SQLite，应用或后端重启后只补传缺失分片
- 图片消息支持气泡展示、临时 URL 自动刷新和全屏预览；文件打开前始终刷新临时 GET URL
- 本地路径和上传进度仅留在 outbox/UI，发送帧会移除这些字段；最终 PUSH 落库后才清理发送端本地副本
- 后端只签发对象存储地址，不中转文件字节；完成 Multipart 时以 S3 `ListParts` 为权威依据
- Android/iOS 支持按住录音、上滑 80px 进入取消区、松开发送，最短 1 秒、最长 60 秒且自动结束只发送一次
- 录音使用 AAC-LC、16 kHz、32 kbps、单声道、`.m4a`/`audio/mp4`，100ms 采集原生 metering 并重采样为 48 点真实振幅波形
- AUDIO 复用现有直传、断点恢复、失败重试、取消、ACK/PUSH 和撤回链路，客户端与服务端上限均为 20 MiB
- 播放器全局单实例，支持点击播放/暂停/继续和切换消息；来电、后台、耳机断开及撤回会暂停或停止且不自动恢复
- 接收语音只有完整播放结束才写入 SQLite `voice_heard` 并消除本地未听点，状态按账号隔离且不上传服务端
- SDK Core 将实时 `LINK_PREVIEW` 按 `cid + seq` 合并到 SQLite 原文本消息，不推进同步位点、未读数或会话排序
- 实时增量和 REST 同步共用链接卡片合法化规则，重复帧幂等，早到帧只在内存保留最多 100 项和 60 秒
- 链接卡片展示站点名或域名、标题和描述，不请求第三方缩略图；点击只通过系统默认浏览器打开 `http(s)`
- 链接抓取、字段校验或浏览器打开失败时降级为原文本或中文提示，不影响发送、提及、撤回和已读链路
- 服务端只采信消息引用的同会话 `targetSeq`，校验目标后重新生成发送者、类型与长度受限的摘要快照
- SDK Core 统一构建和合法化 `TEXT body.quote`，发送中、失败重试、实时推送和离线同步共用同一结构
- 移动端支持引用文本、图片、文件和语音后发送文本，输入区可取消，气泡可定位原消息并感知原消息撤回

关键提交如下：

| 提交 | 内容 |
| --- | --- |
| `7271d54` | 重试定位较早消息 |
| `ec85057` | 支持引用消息 |
| `6caad4e` | 定义消息引用载荷 |
| `b8b1d61` | 生成消息引用快照 |
| `990e463` | 规划消息引用实施步骤 |
| `7903d0c` | 设计消息引用 |
| `b2def5e` | 展示并打开链接卡片 |
| `256c1af` | 接入链接卡片增量帧 |
| `5c359ce` | 持久化链接卡片增量 |
| `ee1cfb4` | 规划链接卡片实施步骤 |
| `34013b4` | 设计链接卡片持久化与展示 |
| `511c7a0` | 统一语音录音文件扩展名 |
| `3110714` | 接入语音录制发送与播放交互 |
| `1fecbb4` | 实现按住录音与振幅浮层 |
| `8b7d6ba` | 实现语音波形播放与未听状态 |
| `38e9ea8` | 实现语音原生适配层 |
| `e10cab0` | 校验服务端语音消息元数据 |
| `5494a6d` | 持久化语音上传与已听状态 |
| `cdfb72b` | 定义语音录播与波形契约 |
| `1ba050a` | 接入语音录播原生依赖 |
| `6c402a2` | 规划语音消息实施步骤 |
| `69e8f2b` | 设计语音录制发送与播放 |
| `4d32006` | 展示并操作图片文件消息 |
| `df16d32` | 接入图片文件原生能力 |
| `2a4f0ea` | 持久化并恢复富媒体上传任务 |
| `b35e69b` | 增加富媒体断点续传接口 |
| `7f6c879` | 支持富媒体分片存储会话 |
| `7459fe9` | 规划图片文件富媒体实现 |
| `87e100c` | 设计图片文件富媒体与断点续传 |
| `8d6455d` | 加深己方消息气泡颜色 |
| `40997c0` | 将己方消息气泡改为淡绿色 |
| `c587193` | 统一聊天气泡与提及颜色 |
| `256240b` | 记录群聊提及开发完成 |
| `1768b4e` | 接入群聊提及交互 |
| `fe0f4ee` | 补全所有人提及间隔 |
| `9a00ed8` | 展示消息提及片段 |
| `f0f5228` | 新增群成员提及面板 |
| `92f0e79` | 增加提及草稿模型 |
| `b79ae70` | SDK 支持发送结构化提及 |
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
- `src/components/AttachmentPickerSheet.tsx`：拍照、相册和文件入口
- `src/components/MediaMessageContent.tsx`：图片/文件气泡、进度和下载状态
- `src/components/ImagePreviewModal.tsx`：图片全屏预览
- `src/voice/useVoiceRecording.ts`：录音权限、60 秒截止、真实振幅采样与 AUDIO 入队
- `src/voice/voicePlaybackCoordinator.ts`：全局单实例播放、下载缓存、系统中断与已听结算
- `src/components/VoiceComposerControl.tsx`：键盘/语音切换、按住录音和上滑取消手势
- `src/components/VoiceRecordingOverlay.tsx`：录音时长、取消区和实时振幅浮层
- `src/components/VoiceMessageContent.tsx`：48 点波形、播放进度和本地未听点
- `packages/im-sdk-core/src/chat/linkCard.ts`：链接卡片字段、URL 协议和长度的统一合法化
- `src/components/LinkCardContent.tsx`：无缩略图卡片、无障碍标签和系统浏览器打开
- `backend/src/main/java/com/rbac/im/service/QuoteService.java`：同会话引用目标校验与服务端权威快照生成
- `packages/im-sdk-core/src/chat/quotePayload.ts`：引用资格、乐观快照、字段长度与下行合法化
- `src/components/MessageQuoteContent.tsx`：输入区预览、气泡引用、撤回占位和原消息定位入口
- `packages/im-sdk-core/src/media/`：上传任务 SQLite 存储、大小分流和断点续传状态机
- `packages/im-sdk-rn/src/adapters/rnMedia*.ts`：原生选择、持久副本、分片传输、下载和文件打开
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

用户已在 2026-07-29 完成早期客户端功能的手动测试，并确认测试全部正常，覆盖双账号单聊、真实用户名、消息顺序、失败状态收敛、重新发送和页面顶部样式。群聊 @ 提及与最新聊天气泡配色尚未执行自动化测试或视觉验证；按用户约定，仅执行了 SDK Core 与移动端 TypeScript 类型检查和 `git diff --check`。

后续排查发现：应用在后台超过 Redis 在线路由的 120 秒生存时间后，React Native 的心跳定时器可能暂停，但 WebSocket 仍保留 `connected` 状态。此时消息能到达后端并落库，网关也能收到出站事件，却因用户路由已过期而无法下发最终 `PUSH`，界面会停留在 `acked` 转圈状态。`62ef0ee` 已在前台恢复时立即重启心跳并发送 `PING`，让紧随其后的 `SEND` 之前先重建路由。该修复尚待用户按下文步骤手动验证。

消息引用完成后再次执行了以下静态检查，命令退出码均为 0。用户明确要求后续功能开发不新增或代跑测试，因此没有运行 Jest、Vitest、JUnit 或 E2E，新窗口只需说明建议手测项，由用户执行：

```bash
cd /Users/xxmm/work/RBAC-Server/im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
git diff --check
```

消息引用的两个组件文件 ESLint 退出码为 0。`ChatScreen.tsx` 在本轮改动前后均精确报告 4 个 `react-hooks/exhaustive-deps` 错误和 21 个 `no-void` 警告，全部来自既有语音录制 Hook 依赖与调用风格，本轮没有扩大 lint 基线。

```bash
cd /Users/xxmm/work/RBAC-Server
mvn -f backend/pom.xml -Dmaven.test.skip=true package
```

本轮未修改 `im-gateway`，因此没有重复执行网关编译。

新增原生依赖后执行了 `npm audit --omit=dev --workspace packages/app-mobile`。当前报告 7 个 moderate，均来自 React Native CLI 20.1.1 间接依赖的 `fast-xml-parser`；自动修复需要 `--force` 升级到声明范围外的 CLI 20.2.0，因此未执行破坏性升级。安全关键字扫描未发现 `console.log`、`api_key`、`secret` 或 `sk-`。iOS `bundle exec pod install` 因本机未安装项目要求的 `cocoapods (>= 1.13, != 1.15.0, != 1.15.1)` gem 而未执行成功；首次 iOS 构建前需先安装 Bundler 依赖，再重新运行该命令。

## 下一窗口优先处理的边界

客户端消息能力按以下顺序继续补齐：

1. 消息撤回：代码已完成。
2. @ 提及：代码已完成，等待用户手动验收。
3. 聊天气泡配色：代码已完成，等待用户确认己方淡绿色、对端白色、正文黑色和提及浅蓝色。
4. 图片与文件消息：代码已完成，等待用户手动验收。
5. 语音消息：代码已完成，用户已手动验收通过。
6. 链接卡片：代码已完成，用户已手动验收通过。
7. 消息引用：代码已完成，等待用户手动验收。
8. 消息免打扰：消息引用验收后开始设计。
9. 置顶聊天：消息免打扰完成后开始设计。

@ 提及的设计和实施记录位于：

- `docs/superpowers/specs/2026-07-29-im-client-mention-design.md`
- `docs/superpowers/plans/2026-07-29-im-client-mention.md`

@ 提及手测需要覆盖：

1. 单个成员提及并正常收发。
2. 多成员提及、重复选择去重。
3. 名称搜索与空搜索列表。
4. 删除完整提及片段、修改片段内部文字后不再携带错误绑定。
5. 群内重名成员分别选择并提醒正确账号。
6. 群主、管理员发送 `@所有人`。
7. 普通成员看不到“所有人”，服务端越权时显示中文错误。
8. 被提及成员退出后发送显示中文错误，失败消息可重发。
9. 被提及方会话列表显示 `[有人@我]`，进入并同步后提醒消除。
10. 双设备实时接收与离线恢复后的文本和高亮一致。
11. 单聊输入 `@` 不打开成员面板。

图片与文件实现记录位于：

- `docs/superpowers/specs/2026-07-29-im-client-image-file-media-design.md`
- `docs/superpowers/plans/2026-07-29-im-client-image-file-media.md`

图片与文件手测需要覆盖：

1. 拍照和相册各发送一张图片，双方实时展示一致。
2. 大图自动缩放压缩；压缩后仍超过 10 MiB 时显示中文提示。
3. 发送小于 5 MiB 的图片/文件，确认走单次上传并正常结算。
4. 发送达到 5 MiB 的图片/文件，确认显示分片上传进度并成功发送。
5. Multipart 中途断网，联网后只续传缺失分片。
6. Multipart 中途杀掉应用，重启并恢复同一账号后继续上传。
7. 上传中取消，气泡消失且不再自动恢复。
8. 上传失败点击红色重试图标，最终只产生一条消息。
9. 图片点击进入全屏预览并可关闭。
10. 等待临时 GET URL 过期后重新进入或触发加载，图片能自动刷新 URL。
11. 文件点击后显示下载进度，并调用系统应用打开。
12. 设备没有匹配应用时显示“没有可打开此文件的应用”。
13. 接收方离线后再同步，图片与文件仍可展示/下载。
14. 切换账号时不显示也不恢复上一账号的上传任务，切回原账号后可恢复。
15. 已发送图片/文件可在两分钟窗口内撤回，双端正文不再展示。

语音消息设计和实施记录位于：

- `docs/superpowers/specs/2026-07-29-im-client-voice-message-design.md`
- `docs/superpowers/plans/2026-07-29-im-client-voice-message.md`

语音消息手测需要覆盖：

1. Android/iOS 首次授权、拒绝、永久拒绝和从设置恢复。
2. 按住录音、上滑取消、移回恢复、松开发送和低于 1 秒提示。
3. 录满 60 秒自动发送且只发送一次，之后松手不产生重复消息。
4. 安静、正常和大声录音时，实时浮层与最终消息波形有明显差异。
5. 单聊、群聊、实时接收和离线恢复后的语音元数据与播放一致。
6. 上传进度、断网重试、杀应用后恢复、主动取消和源文件丢失提示。
7. 播放、暂停、继续、切换另一条，以及播放完成后进度归零。
8. 已下载缓存复用、临时 URL 刷新，以及下载或解码失败后重试。
9. 未听点只在完整播放后消失；暂停、切换和失败不消失；切换账号不串号。
10. 播放时开始录音、退后台、耳机断开和来电等系统打断不会自动续播。
11. 两分钟内撤回语音，双端停止播放并显示撤回占位。
12. 键盘/语音模式往返切换后，尚未发送的文字草稿保持不变。

链接卡片设计和实施记录位于：

- `docs/superpowers/specs/2026-07-30-im-client-link-card-design.md`
- `docs/superpowers/plans/2026-07-30-im-client-link-card.md`

链接卡片手测需要覆盖：

1. 发送含一个链接的文本，正文先出现，卡片随后异步补上。
2. 卡片显示站点名或域名、标题和可选描述，不请求或展示缩略图。
3. 点击卡片由系统默认浏览器打开最终 `http(s)` 地址。
4. 一条文本包含多个链接时只显示首个链接的卡片。
5. 单聊、群聊和双方实时接收时的卡片表现一致。
6. 接收方离线后重新同步、退出聊天页再进入，卡片仍存在。
7. 抓取失败、无标题、非法协议或字段畸形时只显示原文本。
8. 卡片到达后仍可长按撤回；长按不会误开浏览器，撤回后正文与卡片都不再显示。
9. `@` 提及和链接在同一文本中时，高亮与卡片互不影响。
10. 重复增量帧不生成重复卡片，也不改变未读数和会话排序。

消息引用设计和实施记录位于：

- `docs/superpowers/specs/2026-07-30-im-client-message-quote-design.md`
- `docs/superpowers/plans/2026-07-30-im-client-message-quote.md`

消息引用手测需要覆盖：

1. 分别引用文本、图片、文件和语音并发送。
2. 取消引用不清空文字；选择媒体或切换语音模式不消费引用。
3. 点击引用定位并短暂高亮本地原消息；本地缺失时显示提示。
4. 已撤回消息不能新引用；原消息后撤回时既有引用显示撤回占位且不泄露摘要。
5. 引用回复发送失败后重试，引用不丢失且最终只产生一条消息。
6. 单聊、群聊、双方实时接收、接收方离线恢复和页面重进后的展示一致。
7. 回复正文同时包含提及和链接时，正文高亮、引用块和链接卡片互不影响。
8. 客户端伪造或畸形引用字段不能伪造服务端快照，也不能阻断合法正文展示。
9. 撤回引用回复后，正文、引用块和链接卡片均不再展示。

相关实现现状：

- 服务端已实现 `POST /api/im/upload/presign`，请求字段为 `cid/type/filename/mime/size`，响应为 `objectKey/uploadUrl/expiresIn`。
- 服务端新增 `/api/im/upload/multipart/**` 初始化、状态、分片签名、完成、取消接口和 `/api/im/upload/download/presign` 下载刷新接口。
- Flyway `V5__im_media_upload.sql` 持久化服务端 Multipart 会话，并有五分钟一次的过期 abort 清理任务。
- SDK Core 已实现 `MediaUploadService`、AUDIO 元数据白名单、`media_upload_task.metadata_json` 与 `voice_heard` SQLite 表。
- React Native 已安装并装配 Nitro Sound 0.2.15、Nitro Audio Manager 0.3.5、Nitro Modules 0.36.1 与 react-native-permissions 5.6.1；iOS Pods 仍待本机补齐 CocoaPods gem 后安装。
- 后端富媒体设计与实施记录位于 `docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` 和 `docs/superpowers/plans/2026-07-24-im-mvp-phase4-rich-media.md`。

## 已知限制

继续开发前需保留以下上下文：

- 当前移动端已完整接入单聊文本、群聊文本、已读回执、消息撤回、群聊 @ 提及、图片、文件、语音、无缩略图链接卡片和单层消息引用。
- 链接卡片首版刻意不请求第三方 `image`；若以后需要缩略图，应由后端安全抓取并缓存到自有对象存储，不能让客户端自动加载任意 OG 图片地址。
- 应用被系统杀死期间不会继续后台上传；重启进入同一账号后才恢复缺失分片。若以后要求杀进程后仍上传，需要 Android/iOS 原生后台任务。
- 下载文件保存在应用缓存目录，当前没有主动按时间清理；系统可在空间不足时回收，长期可补一个缓存清理策略。
- 当前气泡颜色定义在 `src/ui/theme.ts`：`messageMine=#D5F0E2`、`mention=#5B8DEF`；不要通过修改全局 `successSoft` 调整消息气泡。
- 群成员列表只在聊天页聚焦时加载；加载失败后需重新进入页面再触发 `@`。
- `PUSH_TIMEOUT` 后直接复用原 `clientMsgId` 重发存在边界：如果服务端已落库但最终 `PUSH` 丢失，服务端幂等分支可能只确认重复请求，不会重新推送已存消息
- 上述边界发生后，重新进入会话并执行 REST 同步可以恢复已落库消息；长期修复应让服务端重复请求重新投递既有消息，或让客户端超时后主动同步会话
- 账号切换会清理本地消息，避免不同账号共用 SQLite 数据；不要移除这段清理逻辑
- `adp2`、新建的 Android Virtual Device 和 Android 30 系统镜像只存在于当前开发机

## 新窗口可直接使用的开场指令

将下面内容粘贴到新窗口：

```text
继续开发 IM 前端。先完整阅读：
docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md

当前分支是 feat/im，本轮消息引用提交尚未 push。语音消息和链接卡片已手动验收通过，消息引用等待手动验收。
不要新增或运行测试；每完成一项功能，只告诉我需要手测哪些场景。
先检查工作区和最近提交，再从交接文档的“下一窗口优先处理的边界”继续。
先让用户按文档清单手测消息引用；通过后设计消息免打扰，再设计置顶聊天。
修改完成后先查看 git diff，再提交代码，不要主动 push。
```
