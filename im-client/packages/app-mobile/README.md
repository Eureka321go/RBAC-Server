# IM Mobile

基于 React Native 的企业即时通信客户端，也是 `im-client` 工作区中的移动端实现。项目通过 `@im/sdk-rn` 接入 IM SDK，覆盖登录、单聊、群聊、组织通讯录、富媒体消息、消息同步与群组管理等核心流程。

## 界面预览

点击截图可查看原图。

| 登录 | 会话列表 | 聊天 |
| --- | --- | --- |
| [![登录界面](./docs/images/im-login.png)](./docs/images/im-login.png) | [![会话列表](./docs/images/im-conversations.png)](./docs/images/im-conversations.png) | [![聊天界面](./docs/images/im-chat.png)](./docs/images/im-chat.png) |

| 组织通讯录 | 群设置 |
| --- | --- |
| [![组织通讯录](./docs/images/im-contacts.png)](./docs/images/im-contacts.png) | [![群设置](./docs/images/im-group-settings.png)](./docs/images/im-group-settings.png) |

## IM 核心能力

### 会话与消息

- 支持从组织通讯录发起单聊，并创建、同步和展示单聊或群聊会话。
- 支持文本、图片、文件和语音消息，以及常用表情和链接卡片预览。
- 支持消息引用与原消息定位、群成员 `@`、`@所有人` 和消息撤回。
- 展示消息发送中、上传中、发送失败等状态；失败消息和媒体任务可以重试。
- 支持图片预览、文件下载与系统打开，以及媒体上传、下载进度展示。
- 支持语音录制、滑动取消、播放进度和已听状态。

### 实时通信与本地同步

- 使用 WebSocket 接收实时消息、会话更新、已读回执和撤回结果。
- 展示连接、重连和离线状态，重新进入会话时主动同步最新消息。
- 使用 SQLite 保存本地会话与消息，支持应用重启后的登录态和数据恢复。
- 自动上报已读位置，并在单聊消息中展示对端已读状态。

### 群聊与企业通讯录

- 按部门浏览组织成员，从通讯录直接选择联系人或发起群聊。
- 支持创建群聊、修改群名称、添加和移除成员、退出或解散群聊。
- 支持群主转让、管理员设置和成员禁言，并按照群角色限制管理操作。
- 支持单聊与群聊的消息免打扰，同时保留未读数和 `@` 提醒。

### 移动端体验

- 支持浅色、深色和跟随系统三种外观模式。
- 提供页面进场、消息气泡、弹窗和交互反馈动效，并兼顾系统“减少动态效果”设置。
- 统一处理安全区域、键盘避让、录音权限和媒体文件访问。
- Android 使用 FCM 接收后台消息；前台仅触发同步，不显示系统通知，通知点击会在认证和导航就绪后进入对应会话。

## 技术架构

| 层级 | 技术与职责 |
| --- | --- |
| 应用层 | React Native 0.86、React 19、React Navigation、Zustand |
| React Native SDK | `@im/sdk-rn`，负责原生数据库、凭证、文件、录音与媒体能力适配 |
| 核心 SDK | `@im/sdk-core`，负责认证、会话、消息同步、群组和传输协议 |
| 本地存储 | SQLite 保存会话和消息，Keychain/Keystore 保存登录凭证 |
| 服务通信 | HTTP API 处理业务请求，WebSocket 承载实时事件，FCM 补充 Android 后台提醒，媒体服务处理上传与下载 |

客户端统一通过 [`src/sdk.ts`](./src/sdk.ts) 创建 SDK 实例，页面不直接维护传输连接或数据库。全局登录态与连接状态集中在 [`src/store.ts`](./src/store.ts)，具体会话、通讯录和群组能力由 SDK 模块提供。

## 项目结构

```text
app-mobile/
├── App.tsx                 # 应用启动、登录态路由与主题入口
├── src/
│   ├── screens/            # 登录、会话、聊天、通讯录、群组与设置页面
│   ├── components/         # 消息、输入区、媒体、语音及通用 UI 组件
│   ├── contact/            # 组织通讯录模型
│   ├── conversation/       # 会话展示逻辑
│   ├── emoji/              # 表情输入与文本编辑
│   ├── group/              # 群系统消息展示
│   ├── media/              # 媒体展示逻辑
│   ├── mention/            # 群聊 @ 提及草稿
│   ├── push/               # 推送权限、设备登记、原生桥接与通知导航
│   ├── voice/              # 语音录制与播放协调
│   ├── ui/                 # 主题、动效与视觉令牌
│   ├── sdk.ts              # SDK 与服务地址配置
│   └── store.ts            # 登录态与连接状态
├── __tests__/              # Jest 单元测试与 UI 回归测试
├── android/                # Android 原生工程
└── ios/                    # iOS 原生工程
```

## 开发环境

- Node.js `>= 22.11.0`
- npm（项目使用 npm workspaces）
- Android Studio、Android SDK 与 JDK，用于 Android 开发
- Xcode、Ruby Bundler 与 CocoaPods，用于 iOS 开发

开始前请完成 React Native 的 [开发环境配置](https://reactnative.dev/docs/set-up-your-environment)。

## 本地运行

以下命令默认从 `im-client` 工作区根目录执行。

### 1. 安装 JavaScript 依赖

```sh
npm install
```

### 2. 配置并启动服务端

开发环境服务地址定义在 [`src/sdk.ts`](./src/sdk.ts)：

| 服务 | Android 模拟器 | iOS 模拟器 |
| --- | --- | --- |
| HTTP API | `http://10.0.2.2:8080/api` | `http://localhost:8080/api` |
| WebSocket | `ws://10.0.2.2:9001/im` | `ws://localhost:9001/im` |
| 媒体服务 | `http://10.0.2.2:9000` | `http://localhost:9000` |

先确认对应服务已经启动。真机调试时，需将 `src/sdk.ts` 中的主机名改为开发机在局域网中的可访问地址。

### 3. 启动 Metro

```sh
npm run start --workspace app-mobile
```

### 4. 运行 Android

```sh
npm run android --workspace app-mobile
```

查看可用 Android 设备：

```sh
npm run android-list --workspace app-mobile
```

### 5. Android FCM 推送配置与验收

#### Firebase 客户端配置

1. 在对应环境的 Firebase 项目中创建 Android 应用，package ID 必须是 `com.rayim.eureka32.app`。
2. 下载该环境的 `google-services.json`，放到 `packages/app-mobile/android/app/google-services.json`。仓库根 `.gitignore` 已忽略所有 `google-services.json`，不要强制提交、复制到文档或通过聊天工具传播其内容。
3. 使用带 Google Play 服务的 Android 模拟器或真机安装应用。没有 `google-services.json` 时工程仍可编译，客户端会把推送视为不可用，登录、WebSocket 和消息同步不受影响。
4. 后端通过 ADC 或工作负载身份获取 Firebase Admin 凭证，并设置 `IM_PUSH_ENABLED=true`。客户端配置不能代替服务端凭证；服务账号私钥不得进入仓库、APK、配置文件或日志。

本地开发可以先保持后端推送关闭：

```env
IM_PUSH_ENABLED=false
```

配置好非生产 Firebase 项目和服务端身份后，再在当前进程环境设置 `IM_PUSH_ENABLED=true` 并启动后端。Android 13 及以上在首次成功登录后解释通知用途并由用户选择是否授权；拒绝权限或之后在系统设置中关闭通知不会影响 IM 主功能。Android 12 及以下不需要运行时通知权限，但仍受系统通知设置约束。

用户在系统设置中“强行停止”应用后，Android 不保证普通 FCM 消息送达；再次手动启动应用前不能把该场景视为可靠离线通道。划掉最近任务中的普通进程与“强行停止”不是同一状态，验收时必须分别记录。

#### 自动验证

从仓库根目录执行服务端测试：

```sh
mvn -pl backend -Dtest=PushLogRedactionTest test
mvn -pl backend test
```

完整后端测试依赖项目既有的 MySQL、MongoDB、Redis 和 Kafka 环境；未启动时应启动依赖后重跑，不得跳过集成测试。客户端质量检查：

```sh
cd im-client/packages/app-mobile
npm test -- --runInBand
npm run lint
npx tsc --noEmit
```

Android 完整原生聚合验证的目标命令是：

```sh
cd im-client/packages/app-mobile/android
./gradlew testDebugUnitTest assembleDebug
```

当前项目中的 `react-native-keychain` 仍使用 `gradle-test-logger` 2.0，它在 Gradle 9.3.1 配置测试任务时会尝试写入只读的 `consoleType` 属性，因此上述根聚合命令会在配置阶段失败。修复或升级该依赖后，必须恢复执行根聚合命令，不能长期用局部验证替代。

在此已知问题修复前，可执行以下 app 模块验证：

```sh
cd im-client/packages/app-mobile/android
./gradlew :app:testDebugUnitTest --tests 'com.rayim.eureka32.app.push.*' --configure-on-demand
./gradlew :app:assembleDebug --configure-on-demand
```

第一条替代命令只覆盖 app 模块中的推送原生单元测试，不会运行 `react-native-keychain` 等全部依赖模块的测试；第二条只验证 app Debug APK 可构建。验收记录必须同时保留根聚合命令的已知失败和这两项局部结果，不能把局部成功写成完整 Android 测试通过。

自动化测试不访问真实 FCM，也不要求生产凭证。提交前还应运行 `git diff --check`，并从本功能最早实现前的基线提交扫描新增差异中的服务账号标识字段、PEM 私钥头和 `google-services.json`；扫描结果只能报告匹配文件或“无匹配”，不能打印秘密内容。

#### 后端运行参数与故障处理

- `IM_PUSH_ENABLED` 默认 `false`，是推送发布、消费和 Firebase Admin 初始化的总开关。
- `rbac.im.push.fresh-days` 默认 30，只选择最近活跃且有效的设备登记。
- `rbac.im.push.ttl-seconds` 默认 86400，控制 FCM 数据消息 TTL；修改后应重新验证过期消息行为。
- Kafka 消费最多尝试 4 次，使用 1 秒起步、最大 30 秒并带抖动的指数退避；耗尽后进入 `im-push.DLT`。永久无效目标直接禁用，不进入无意义重试。
- 关注 `im.push.candidates`、`im.push.targets`、`im.push.delivery`、`im.push.latency`、`im.push.dlt`。FCM 接收请求仅表示 Firebase 接受发送任务，不代表设备已显示通知。
- 日志、异常、链路追踪、指标标签和验收记录不得包含 FCM 目标、原始 Payload、消息摘要、发送人、访问令牌或 Firebase 凭证。允许记录 `msgId`、系统版本、App 状态、FCM 接收时间和枚举化粗粒度错误码。

#### 真机验收矩阵

当前仓库没有可供自动化控制的真机或带 Google Play 服务的模拟器，以下项目状态均为“待人工”，不得标记为已通过。至少分别使用 Android 12 和 Android 13 及以上设备执行；Android 13 及以上还要分别覆盖权限允许、拒绝和之后在系统设置中关闭。

| 场景 | Android 12 | Android 13 及以上 | 核对结果 |
| --- | --- | --- | --- |
| 前台收到单聊/群聊消息：只同步，不显示系统通知 | 待人工 | 待人工（权限允许/拒绝） | 待填写 |
| 后台与锁屏收到消息：发送人和安全摘要正确 | 待人工 | 待人工（权限允许） | 待填写 |
| 划掉普通进程后接收；强行停止后确认已知限制 | 待人工 | 待人工 | 待填写 |
| 冷启动和热启动点击通知进入正确会话并同步 | 待人工 | 待人工 | 待填写 |
| 免打扰普通消息不通知，`@我`/`@所有人`仍通知 | 待人工 | 待人工 | 待填写 |
| 短时间多条消息正确分组；多个会话互不覆盖 | 待人工 | 待人工 | 待填写 |
| 同一账号多设备收到；发送者自己的其他设备不收到 | 待人工 | 待人工 | 待填写 |
| 退出、账号切换后不展示旧账号延迟通知 | 待人工 | 待人工 | 待填写 |
| 权限拒绝/系统关闭通知后 IM 登录、WebSocket、同步正常 | 不适用/系统设置关闭 | 待人工 | 待填写 |
| 过期登记、临时网络中断、重复投递与恢复 | 待人工 | 待人工 | 待填写 |

每次执行使用以下模板记录，不附 Payload、FCM 目标、消息摘要或发送人：

```text
日期：
设备/Android 版本：
场景与 App 状态：前台 / 后台 / 锁屏 / 普通进程被划掉 / 强行停止 / 冷启动
通知权限：允许 / 拒绝 / 系统设置关闭 / 不适用
msgId：
FCM 接收时间：
粗粒度结果码：SUCCESS / PERMISSION_DENIED / INVALID_PAYLOAD / ACCOUNT_MISMATCH / DUPLICATE / TIMEOUT / UNKNOWN
结果：通过 / 失败 / 受强行停止限制
备注（不得写 Payload、目标、摘要或发送人）：
```

### 6. 运行 iOS

首次运行或原生依赖变化后，先安装 CocoaPods 依赖：

```sh
cd packages/app-mobile
bundle install
bundle exec pod install --project-directory=ios
```

保持 Metro 运行，再从 `packages/app-mobile` 执行：

```sh
npx react-native run-ios
```

也可以直接使用 Android Studio 或 Xcode 打开对应原生工程。

## 质量检查

在 `packages/app-mobile` 目录执行：

```sh
npm test
npm run lint
npx tsc --noEmit
```

测试覆盖主题、动效、导航、页面布局、消息气泡和关键交互回归。
