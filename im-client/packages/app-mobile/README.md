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

## 技术架构

| 层级 | 技术与职责 |
| --- | --- |
| 应用层 | React Native 0.86、React 19、React Navigation、Zustand |
| React Native SDK | `@im/sdk-rn`，负责原生数据库、凭证、文件、录音与媒体能力适配 |
| 核心 SDK | `@im/sdk-core`，负责认证、会话、消息同步、群组和传输协议 |
| 本地存储 | SQLite 保存会话和消息，Keychain/Keystore 保存登录凭证 |
| 服务通信 | HTTP API 处理业务请求，WebSocket 承载实时事件，媒体服务处理上传与下载 |

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

### 5. 运行 iOS

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
