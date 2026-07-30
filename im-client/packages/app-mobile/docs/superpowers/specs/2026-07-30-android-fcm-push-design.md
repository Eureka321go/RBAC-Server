# 为 Android IM 接入 FCM 消息推送

本文设计一套适配现有 React Native 客户端和 Spring Boot 服务端的 Android 消息推送方案。第一期只支持带 Google Play 服务的设备，并通过 Firebase Cloud Messaging（FCM）发送通知。前台继续使用 WebSocket 接收消息，后台或进程被系统终止时显示包含发送人和消息摘要的原生通知。

FCM 只负责提醒，不作为消息数据源。FCM 的延迟或故障不能阻塞消息落库、确认、WebSocket 投递和后续增量同步。

## 已确认的产品规则

本期采用以下产品规则：

- 第一版只支持 FCM，不接入华为、小米、OPPO、vivo 等厂商通道
- 客户端和服务端都可以修改
- App 在前台时不显示系统通知，继续通过 WebSocket 和 SQLite 同步链展示消息
- App 在后台，或 FCM 拉起已被系统终止的进程时，显示原生通知
- 通知显示发送人和安全的消息摘要
- 普通会话正常通知
- 免打扰会话不通知普通消息，但 `@我` 和 `@所有人` 仍然通知
- 发送者自己的所有设备都不接收这条消息的 FCM 通知
- 点击通知后进入对应会话，再通过现有 SDK 同步权威消息

## 现有系统情况

当前服务端已经具备完整的实时消息链。`MessageAppender` 生成会话内序号，将消息保存到 MongoDB，更新 MySQL 会话摘要，再调用 `OutboundDispatcher`。`OutboundDispatcher` 从 Redis 查询在线设备路由，将 `im-outbound` 数据包写入 Kafka。`im-gateway` 消费数据包，并向在线连接发送 WebSocket `PUSH` 帧。

React Native 客户端通过 `@im/sdk-rn` 和 `@im/sdk-core` 把会话与消息保存到 SQLite。客户端已经支持稳定的安装级 `deviceId`、登录恢复、WebSocket 重连、增量同步、会话免打扰，以及经过服务端校验的 `@我` 和 `@所有人` 元数据。

Android 工程目前没有 Firebase 依赖、通知权限、通知渠道、FCM 服务或通知点击路由。

服务端不能根据 Redis 中是否存在 WebSocket 路由来判断是否发送 FCM。App 进入后台后，Socket 路由可能继续存在，JavaScript 定时器却可能被 Android 挂起。依赖该路由会形成漏推窗口。

## 总体架构

每条通过校验的用户消息取得权威的 `msgId`、`cid`、`seq` 和时间戳后，进入两条互不依赖的下游链路：

1. 现有实时链路把消息写入 `im-outbound`，再通过 WebSocket 到达在线设备，最终进入 SDK 和 SQLite
2. 新通知链路把精简的 `PushCandidate` 写入 Kafka 的 `im-push` 主题，由独立消费者筛选接收人和设备，再调用 Firebase Admin SDK

FCM 消费者不参与消息接收事务。FCM 响应慢或不可用时，不影响消息确认、落库、WebSocket 投递或后续 REST 增量同步。

Kafka 采用至少一次消费语义，可能重复投递同一个候选事件。Android 客户端必须使用 `msgId` 消除重复通知。

第一期把推送生产者和消费者放在现有后端服务中，不新增部署单元。推送消费者使用独立的监听并发数、有限重试策略和死信主题，避免占用 `im-logic` 消费者资源。

## 服务端组件

### 返回完整的已落库消息结果

`MessageAppender.append` 当前只返回 `seq`，而 `msgId` 和时间戳在方法内部生成。修改后返回 `AppendedMessage`，包含 `msgId`、`seq` 和 `ts`。现有 WebSocket 分发逻辑保持不变。

`InboundMessageConsumer` 按以下顺序处理消息：

1. 校验消息和提及目标
2. 调用 `MessageAppender` 完成定序、落库和 WebSocket 分发
3. 推进 `mention_seq`
4. 发布 `PushCandidate`

候选事件在 `mention_seq` 更新后发布，确保推送接收人分类与持久化的提及状态一致。

第一期只为用户可见的用户消息生成候选事件，包括 `TEXT`、`IMAGE`、`AUDIO` 和 `FILE`。`READ`、`RECALL`、链接卡片补充、错误帧和管理控制帧不生成新消息通知。

系统消息暂不自动通知。后续如果需要通知部分 `SYSTEM` 消息，应先明确哪些系统事件值得打扰用户，再扩展规则。

### 定义推送候选事件

内部 Kafka 记录只包含筛选和显示通知需要的数据：

- 协议版本
- `msgId`、`cid`、`seq`、发送者 ID、消息类型和时间戳
- 服务端生成的安全摘要，不包含完整媒体或消息正文
- 已校验的提及目标 ID 列表
- 会话类型，以及群聊对应的群 ID

记录中禁止包含访问令牌、刷新令牌、媒体签名地址、上传元数据或 Firebase 凭证。摘要可能包含消息文本，因此 `im-push` 主题按敏感数据管理。

### 筛选推送接收人

`PushRecipientResolver` 读取最新会话成员信息，并按以下顺序筛选：

1. 按用户 ID 排除发送者，从而排除发送者的所有设备
2. 排除已删除成员和已经离开会话的成员
3. 保留未开启免打扰的成员
4. 对已开启免打扰的成员，仅保留经过服务端校验的提及目标
5. 为每个接收人查询仍有效且未过期的 Android FCM 登记

消费者处理候选事件时读取最新免打扰状态。如果免打扰设置与消息接收同时发生，则以数据库实际提交顺序为准。本设计不承诺跨数据库的全局顺序。

### 异步发送 FCM

`FcmPushSender` 封装 Firebase Admin SDK，并发送 Android 高优先级 data message。每个安装实例的 Payload 都包含当前账号绑定，因此使用 `sendEach` 分批发送，每批最多 500 条，并按输入顺序关联返回结果。

临时错误采用带抖动的有限指数退避重试。达到重试上限后，消息进入 `im-push.DLT`。无效或已注销的目标属于永久错误，消费者立即禁用对应登记。

即使所有 FCM 请求都失败，已经接收的 IM 消息仍然保持成功状态。

配置项 `rbac.im.push.enabled` 控制推送功能。开发和测试环境未配置 Firebase 凭证时默认关闭，生产环境必须显式开启。

## 设备登记数据模型

新增 Flyway 迁移和 `im_push_registration` 表。字段职责如下：

| 字段 | 用途 |
| --- | --- |
| `id` | 自增主键 |
| `user_id` | 当前绑定到该安装实例的已认证账号 |
| `device_id` | 现有 WebSocket 使用的稳定安装级设备 ID |
| `platform` | 第一版固定为 `ANDROID` |
| `provider` | 固定为 `FCM` |
| `target_type` | 新接入默认使用 `FID`，迁移兼容时允许 `TOKEN` |
| `target_value` | 敏感的 FCM 目标值，不写入日志或 API 响应 |
| `target_hash` | `target_value` 的 SHA-256，用于固定长度查询和唯一约束 |
| `app_version` | 客户端版本，用于排查版本相关的登记问题 |
| `enabled` | 是否允许发送 |
| `last_seen_at` | 客户端最后一次刷新登记的时间 |
| 审计字段 | 沿用项目现有的创建、更新和逻辑删除字段 |

使用 `(user_id, device_id, provider)` 唯一键实现幂等登记。使用 `(provider, target_hash)` 唯一键保证一个 FCM 目标只绑定一个当前账号，同时避免对长度可变的敏感原文建立索引。

客户端重新登记时，服务端在一个事务中把目标移动到当前认证账号并启用。服务端不能从请求体接收 `user_id`。

无关服务使用的数据库账号不能读取该表。异常、结构化日志、链路追踪和指标中都要隐藏目标值。如果部署环境已经提供 KMS 或信封加密能力，`target_value` 应使用该能力；本期不为此单独引入新的密钥管理系统。

Firebase 正在把程序化目标从 registration token 迁移到 Firebase Installation ID（FID）。新安装实例使用 FID，`target_type` 为旧 token 保留兼容路径，避免以后再改数据库结构。参考 [Firebase 登记管理建议](https://firebase.google.com/docs/cloud-messaging/manage-tokens) 和 [Firebase Admin 发送指南](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk)。

## 设备登记 API

所有接口沿用现有 `/api` 基础路径，并从 Spring Security 上下文读取当前用户。

### 幂等登记设备

客户端调用 `PUT /im/push/registrations/{deviceId}` 登记或刷新设备：

```json
{
  "platform": "ANDROID",
  "provider": "FCM",
  "targetType": "FID",
  "targetValue": "firebase_installation_id_here",
  "appVersion": "1.0"
}
```

接口校验字段长度、枚举值和路径中的 `deviceId`，成功后返回 `204 No Content`。重复请求得到相同结果。

同一目标由新账号提交时，服务端替换旧账号绑定。这个规则可以防止共享设备一直保留旧账号登记。

### 解绑当前设备

客户端调用 `DELETE /im/push/registrations/{deviceId}` 解绑设备。接口只禁用或删除当前认证用户的匹配记录，不允许通过猜测 `deviceId` 删除其他用户的登记。

记录不存在时仍返回 `204 No Content`。

### 控制刷新频率

通知权限可用后，客户端在成功登录或恢复登录态时执行一次登记。如果 Firebase 安装标识发生变化，客户端立即刷新登记。

活跃使用期间最多每七天刷新一次，以更新 `last_seen_at`。客户端不在每次回到前台时上传登记。

如果用户拒绝通知权限，或在系统设置中关闭通知，客户端不创建新登记，并在下次回到前台时禁用已有登记。该状态不能阻止登录、WebSocket 消息或同步。

客户端退出登录时按以下顺序执行：

1. 清除原生层当前账号绑定，立即拦截延迟到达的旧账号推送
2. 在访问令牌仍有效时，尽力调用服务端删除登记接口
3. 停止媒体和 WebSocket 活动，再完成现有认证退出流程

删除请求失败不会泄露旧账号通知。原生账号校验会丢弃旧 Payload，下次登记也会原子替换账号绑定。

## FCM 数据协议

FCM 发送带版本号的 data message，不使用 Android notification payload。原生代码因此可以统一处理通知渠道、消息分组、前台抑制、重复检测和点击路由。

Payload 示例：

```json
{
  "version": "1",
  "event": "NEW_MESSAGE",
  "recipientUserId": "42",
  "msgId": "abc123",
  "cid": "g_100",
  "seq": "86",
  "conversationType": "GROUP",
  "groupId": "100",
  "title": "研发群",
  "senderName": "张三",
  "preview": "今晚八点发布",
  "mentioned": "true",
  "ts": "1785400000000"
}
```

FCM data 字段值均为字符串。完整 Payload 必须低于 FCM 即时消息 4096 字节的限制。

服务端生成 `preview` 时执行以下处理：

- 把换行和连续空白折叠为空格
- 按 Unicode 码点截断，避免切断代理对
- 文本只保留短摘要
- 图片、语音和文件分别使用 `[图片]`、`[语音]` 和 `[文件]`
- 不包含对象存储 Key 或签名地址

单聊通知以发送人作为标题，以摘要作为正文。群聊通知以群名称作为标题，以 `发送人：摘要` 作为正文。

服务端生成候选事件时读取权威的当前名称。通知文案只用于提醒，不能直接保存为本地权威消息。

消息使用 Android 高优先级、24 小时有效期和不可折叠模式。聊天消息具有独立的用户价值，不能让新消息在 FCM 队列中替换旧消息。

FCM 不保证消息顺序。`seq` 只用于诊断和同步提示，客户端不能依据 Payload 直接写消息库。参考 [FCM 消息优先级指南](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-priority) 和 [FCM 可折叠消息指南](https://firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types)。

## Android 原生组件

### 接入 Firebase

Android 工程接入 Google Services Gradle 插件、Firebase Android BoM、Firebase Messaging 和 Firebase Installations 主模块。不要引入已经停止更新的 Firebase KTX 模块。

Firebase 客户端配置位于 `android/app/google-services.json`。该文件包含项目标识，不包含服务端私钥。各环境必须通过项目既有的配置或部署方式提供对应文件。

在 Firebase 创建 Android 应用前，必须确定正式的 package ID。除非明确需要，否则调试环境和生产环境不能共用生产发送身份。参考 [Firebase Android 接入指南](https://firebase.google.com/docs/android/setup)。

### 提供聚焦的原生桥接模块

新增一个职责单一的 React Native 原生模块，向 JavaScript 提供以下能力：

- 获取稳定的 Firebase 安装目标和目标类型
- 查询通知权限和系统通知开关
- 设置或清除当前账号绑定
- 读取排队中的通知点击事件和前台推送事件

应用层还需要读取 SDK 现有的 installation `deviceId`，确保设备登记和 WebSocket 路由使用同一个标识。该值仍由 `@im/sdk-rn` 生成和保存，推送功能不能再创建一个业务设备 ID。

### 在原生服务中处理 FCM

`ImFirebaseMessagingService` 收到 data message 后执行以下校验：

1. 只接受支持的 `version` 和 `event`
2. 校验 `msgId`、`cid`、`seq`、标题、发送人和摘要的格式与长度
3. 比较 `recipientUserId` 与原生层当前账号，不存在或不匹配时丢弃
4. 查询有容量和时间限制的持久化 `msgId` 去重集合，已经处理过则丢弃
5. 如果存在已恢复的 Activity，则把轻量同步事件排队给 JavaScript，不显示系统通知
6. 否则创建或更新对应会话的系统通知

JavaScript 收到前台事件后，只把它当作同步提示，并调用现有会话同步流程。SDK 的 `cid`、`seq` 约束和 SQLite 唯一键继续负责权威去重。FCM Payload 不能直接写入消息表。

普通进程终止后，Android 可能启动 FCM 服务所在进程。该服务不能依赖 React 状态、Zustand、已经启动的 JavaScript Bundle 或已经打开的 SQLite 数据库。

服务只依赖原生持久化的账号绑定和去重元数据。用户在系统设置中强行停止 App 后，Android 不再保证普通 FCM 消息送达，本设计只记录并说明该限制。

### 统一生成和分组通知

`MainApplication` 创建两个固定渠道：

- `messages`：普通消息，默认重要级别
- `mentions`：`@我` 和 `@所有人`，高重要级别

Android 创建渠道后，渠道设置由用户控制，因此渠道 ID 必须长期稳定。发送通知前，协调器检查 `POST_NOTIFICATIONS` 权限和 `NotificationManagerCompat.areNotificationsEnabled()`。

每个 `cid` 映射到一个稳定通知 ID。原生层只保存构建 `InboxStyle` 所需的少量近期摘要。连续消息更新同一个会话通知和未读计数。

所有会话通知使用相同的 group key。多个会话同时存在时，可以显示一个汇总通知。用户打开会话后，客户端清除该会话通知。

通知使用 `VISIBILITY_PRIVATE`，由 Android 锁屏隐私设置决定是否显示详情。通知点击使用显式、不可变的 `PendingIntent`，目标为现有 single-task `MainActivity`，不新增对外暴露的自定义深链 Intent Filter。

### 申请通知权限

AndroidManifest 声明 `POST_NOTIFICATIONS`。Android 13 及以上版本在首次成功登录后先解释用途，再请求权限。冷启动且尚未认证时不能直接弹出权限框。

用户关闭提示或拒绝权限后，App 保持可用。设置页可以提供进入 Android 通知设置的入口，但不能重复打扰用户。Android 13 的新安装默认关闭通知，必须得到用户授权。参考 [Android 通知权限指南](https://developer.android.com/develop/ui/compose/notifications/notification-permission)。

### 处理通知点击导航

`MainActivity.onCreate` 和 `onNewIntent` 把经过校验的通知参数转交给原生模块。顶层导航协调器保存最近一次点击请求，直到以下条件全部成立：

1. App 启动完成
2. 目标接收账号已经登录
3. NavigationContainer 已经就绪

满足条件后，协调器打开 `Chat`，传入 `cid`、会话类型、可选群 ID、安全的备用标题和 `syncOnOpen: true`。Chat 页面继续通过现有 API 同步消息。

如果用户未登录，请求只在后续登录账号匹配时继续处理。如果用户已经被移出会话，或会话不存在，同步流程显示现有可恢复错误，并返回会话列表。客户端不能信任过期 Payload 绕过成员校验。

## 投递与故障语义

推送链遵守以下可靠性规则：

- FCM 只负责提醒，不负责保存消息
- WebSocket、REST 增量同步和 SQLite 仍是权威数据链
- Kafka 重试可能重复候选事件，因此原生 `msgId` 去重是必需能力
- FCM 可能延迟、乱序、过期或丢弃消息，点击通知后始终从服务端同步
- `FirebaseMessagingService.onDeletedMessages` 触发一次待执行的全量 SDK 同步，在下次安全回到前台时执行
- 原生去重集合同时限制记录数量和保留时间，避免变成另一份消息数据库
- 客户端丢弃非法 Payload，只记录低基数错误分类，不记录原始内容
- 开发环境缺少 Firebase 配置时关闭推送并输出明确的健康状态，但不能阻止服务端或 App 启动
- 死信记录只保留精简候选事件和错误分类，并使用与其他消息 Kafka 主题相同的访问和保留策略

FCM 在积压超过限制时可能回调 `onDeletedMessages`。具体行为参考 [Android FCM 消息接收指南](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)。

## 安全与隐私

推送实现必须满足以下安全要求：

- 通过 Application Default Credentials、工作负载身份或挂载的 Secret 提供 Firebase Admin 凭证
- 禁止把服务账号私钥提交到仓库、写入 APK、放入 `application.yml` 或输出到日志
- Android APK 只包含 Firebase 客户端配置，不包含服务账号私钥
- 设备登记接口必须鉴权，并从服务端认证上下文读取用户 ID
- 接口校验所有输入，不能仅凭 `deviceId` 修改其他用户的记录
- 日志、链路追踪、指标标签、异常和管理页面禁止输出 FCM 目标与原始 Payload
- Payload 只包含已确认需要显示的最小摘要，不包含凭证、签名地址、引用快照、完整媒体信息或隐藏属性
- `recipientUserId` 用于拦截同一安装实例切换账号后延迟到达的旧通知
- 显式不可变 PendingIntent 和严格的原生参数校验用于防止可变 Intent 注入和非法导航参数
- 点击通知不能绕过服务端授权和会话成员校验

## 可观测性

服务端记录以下低基数指标：

- 候选事件发布数和消费数
- 因发送者、免打扰或无登记而排除的接收人数
- FCM 尝试数、接收数、永久无效数、临时失败数、重试数和死信数
- 从候选事件生成到 FCM 接收请求的延迟

在本地遥测策略允许时，客户端记录以下事件数量：

- Payload 非法
- 账号不匹配
- 重复通知被抑制
- 前台通知被抑制
- 通知已显示
- 通知已打开

指标和结构化日志只使用 `msgId` 与粗粒度错误码标识消息。禁止记录摘要、发送人、FCM 目标、访问令牌和 Firebase 凭证。

FCM 接收请求只表示 Firebase 接受了发送任务，不表示设备已经显示通知。

## 测试方案

### 服务端单元测试

服务端单元测试覆盖以下行为：

- 设备登记幂等更新、账号重绑、鉴权删除、枚举和长度校验、过期过滤
- 排除发送者、已删除成员、免打扰普通消息，以及保留免打扰提及消息
- 文本、换行、Unicode 截断、图片、语音和文件摘要生成
- 只在消息落库和提及状态更新后生成候选事件
- 每 500 个目标分批、输入结果关联、无效目标禁用、临时错误分类和 Payload 脱敏

### 服务端集成测试

服务端集成测试覆盖以下链路：

- 使用 MockMvc 和 Flyway 表验证完整的鉴权登记生命周期
- 使用假的 `PushSender` 验证 Kafka 成功、重试、永久失败、重复消费和死信
- 验证 FCM 故障不改变消息落库、WebSocket 分发和增量同步结果

Firebase Admin SDK 必须封装在接口后。自动化测试不能访问真实 FCM，也不能要求生产凭证。

### Android 与 React Native 测试

客户端自动化测试覆盖以下行为：

- 原生 Payload 校验、账号不匹配、重复检测、前台抑制、权限拒绝、渠道选择、稳定会话通知 ID 和不可变 Intent
- `onCreate` 与 `onNewIntent` 的冷启动和热启动点击处理
- App 未启动、未认证、导航未就绪、匹配账号登录和不匹配账号登录时的待处理导航
- 前台推送只触发同步，不直接插入 Payload 数据
- 现有登录、退出、WebSocket、会话和 Chat 导航测试继续通过

### 真机验证矩阵

使用 Android 12 和 Android 13 及以上的真机或带 Google Play 服务的模拟器。验证以下场景：

- 权限允许、拒绝和之后在系统设置中关闭
- 前台、后台、锁屏、划掉普通进程、冷启动点击和强行停止限制
- 单聊、群聊、免打扰普通消息和免打扰提及消息
- 短时间多条消息、多个会话、多设备和账号切换
- 过期登记和临时网络中断

## 验收标准

实现完成后必须满足以下标准：

- 已授权且登记有效时，后台消息正常显示包含发送人和安全摘要的通知
- App 在前台时不显示系统通知，同时仍通过现有 SDK 接收或同步消息
- 免打扰会话不通知普通消息，经过校验的 `@我` 和 `@所有人` 仍然通知
- 发送者的所有已登记设备都不接收该消息的 FCM 通知
- Kafka 或 FCM 重复投递时，同一安装实例对同一 `msgId` 最多显示一次通知
- 冷启动或热启动点击通知后，在启动、认证和导航就绪后进入正确会话并执行权威同步
- 共享安装实例切换账号后，旧账号延迟 Payload 被丢弃
- 拒绝通知权限不影响登录、WebSocket 消息、本地数据和同步
- FCM 故障、开发环境缺少配置或目标失效不能导致已接收的 IM 消息失败
- 日志、链路追踪和指标不能暴露 FCM 目标、Firebase 凭证、访问令牌或消息摘要

Android 电源管理、网络条件、用户通知设置和 FCM 投递都不受本系统完全控制，因此本期只监控投递时间，不承诺严格的端到端时延 SLA。

## 发布步骤

发布按以下顺序进行：

1. 部署数据库结构和设备登记 API，保持 FCM 发送开关关闭
2. 使用非生产 Firebase 项目发布内部 Android 构建，验证权限、渠道、Payload 和点击行为
3. 只为内部账号开启推送消费者，监控无效目标、重试率和现有消息链延迟
4. 分批扩大范围，同时保留服务端功能开关和死信监控
5. 在全量发布前，记录 Firebase 项目责任人、凭证轮换、环境映射和强行停止限制

## 范围边界

第一期不实现以下能力：

- iOS 和 Apple Push Notification service（APNs）
- 国内 Android 厂商通道
- Web 推送和营销通知
- Topic 广播
- 通知内回复和标记已读操作
- 音视频来电通知
- 端到端加密的通知摘要
- 用户级通知预览隐私开关
- 严格的推送投递 SLA
- FCM 事务发件箱

本方案不替换 WebSocket、REST 增量同步、SQLite、现有消息结构或 Android 系统通知控制。
