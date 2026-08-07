# Android FCM 集成与排障指南

本文记录 RBAC-Server 的 Android IM 推送实现、后端配置方式，以及一次完整的本地联调排障过程。目标是让新的开发环境能够按同一套步骤完成 FCM 配置，并能快速判断问题位于客户端、后端、Kafka 还是模拟器网络。

## 1. 最终可工作的链路

```text
test 发送 IM 消息
  -> Kafka: im-inbound
  -> 后端消息消费者：落 MongoDB、发布 im-push 候选
  -> PushCandidateConsumer（Kafka: im-push）
  -> Firebase Admin SDK
  -> FCM
  -> Android FirebaseMessagingService
  -> NotificationCoordinator
  -> Android 系统通知
```

设备登记使用 FCM registration token（`TOKEN`）。服务端保留 `FID` 兼容分支，用于已有的历史登记；新 Android 客户端默认上传 TOKEN。

## 2. 前置条件

### 2.1 Firebase 项目

1. 在 Firebase Console 创建或选择项目。
2. 添加 Android 应用，包名必须与客户端一致：`com.rayim.eureka32.app`。
3. 下载 `google-services.json`，放到：

   ```text
   im-client/packages/app-mobile/android/app/google-services.json
   ```

4. 在 Google Cloud IAM 中创建服务账号并下载 JSON 密钥。该文件只保存在本机安全位置，绝不提交 Git、绝不贴到日志或文档中。

服务账号应具有发送 FCM 所需权限；本项目使用 Firebase Admin SDK 的 Application Default Credentials（ADC）读取该 JSON 文件。

### 2.2 Android 模拟器/设备

- 使用带 Google Play 的 Android 系统镜像，并确保 Google Play services 可用。
- Android 13+ 必须授予通知权限。
- 设备必须可以访问互联网和 FCM；公司网络/防火墙应允许 FCM 所需网络连接。
- 开发模拟器访问宿主机使用 `10.0.2.2`，不是 `localhost`。

## 3. Android 客户端集成

### 3.1 Firebase 依赖与服务声明

Android App 模块通过 Firebase BOM 引入 `firebase-messaging`。消息接收服务在 Manifest 中声明：

```xml
<service
    android:name=".push.ImFirebaseMessagingService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

接收入口为：

- `im-client/packages/app-mobile/android/app/src/main/java/com/rayim/eureka32/app/push/ImFirebaseMessagingService.kt`

它只处理 data payload。根据前台状态和当前登录用户决定：

- 前台：向 React Native 发送同步事件，不额外弹系统通知。
- 后台：调用 `NotificationCoordinator` 创建 Android 通知。
- 收件账号不匹配、重复消息：直接丢弃。

### 3.2 获取并上传 registration token

原生桥 `PushNotificationModule` 使用：

```kotlin
FirebaseMessaging.getInstance().token
```

获取 token 后返回：

```json
{
  "targetType": "TOKEN",
  "targetValue": "<FCM registration token>",
  "targetFingerprint": "<token 的 SHA-256>",
  "appVersion": "<app version>"
}
```

`targetValue` 和 token 本身不得打印或写入前端日志。客户端仅使用 fingerprint 做本地登记缓存判断。

相关文件：

- `android/app/src/main/java/.../push/bridge/PushNotificationModule.kt`
- `android/app/src/main/java/.../push/bridge/FcmInstallationRegistration.kt`
- `src/push/nativePush.ts`
- `src/push/pushRegistration.ts`
- `src/push/pushPermission.ts`

登录后，客户端会先确认 Android 通知权限，再调用：

```text
PUT /api/im/push/registrations/{deviceId}
```

请求内容中的 `platform=ANDROID`、`provider=FCM`、`targetType=TOKEN` 由客户端固定提供。

### 3.3 前台、后台与强制停止的差异

| 状态 | 预期行为 |
| --- | --- |
| App 在前台 | 收到 data message 后同步会话，不弹系统通知 |
| App 在后台/从最近任务划走 | FCM 可唤起消息服务，显示系统通知 |
| 设置中“强制停止”或 `adb force-stop` | 不接收；必须手动打开一次 App 才恢复 |

因此，验证后台通知时用 Home 键或最近任务切换 App；不要用 `adb force-stop`。

## 4. Spring Boot 后端集成

### 4.1 配置开关

`backend/src/main/resources/application.yml` 中的开关为：

```yaml
rbac:
  im:
    push:
      enabled: ${IM_PUSH_ENABLED:false}
      fresh-days: 30
      ttl-seconds: 86400
```

`IM_PUSH_ENABLED=true` 时，以下组件才会创建：

- `FirebaseAdminConfig`
- `FirebaseAdminFcmGateway`
- `PushCandidateConsumer`
- `PushDeliveryService`

### 4.2 Firebase Admin SDK

`FirebaseAdminConfig` 使用：

```java
GoogleCredentials.getApplicationDefault()
```

因此运行环境必须设置：

```text
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json
```

后端不应把服务账号 JSON 打包进镜像，也不应把私钥放在 `application.yml`。

### 4.3 推送登记表

Flyway migration `V7__im_push_registration.sql` 创建 `im_push_registration`。关键字段：

| 字段 | 作用 |
| --- | --- |
| `user_id` | 推送接收人 |
| `device_id` | 当前安装实例的应用设备标识 |
| `target_type` | `TOKEN` 或历史兼容的 `FID` |
| `target_value` | FCM 定向目标，禁止记录到日志 |
| `target_hash` | 用于比对、失效禁用和日志脱敏 |
| `enabled` | FCM 返回永久错误后置为 `0` |
| `last_seen_at` | 只向近期登记的设备投递 |

### 4.4 FCM payload 与投递

`FcmPayloadFactory` 构造 data payload：`recipientUserId`、`cid`、`msgId`、`seq`、`conversationType`、`title`、`preview` 等。

`FirebaseAdminFcmGateway` 根据目标类型调用：

```java
builder.setToken(targetValue); // 新客户端
builder.setFid(targetValue);   // 历史兼容
```

网关使用高优先级和 24 小时 TTL。日志只输出批次成功/失败数量和安全错误码，禁止输出 token、FID 或消息正文。

## 5. Docker 本地运行

### 5.1 配置凭据路径

在 `deploy/.env`（该文件已忽略）设置本机文件路径：

```dotenv
FIREBASE_CREDENTIALS_FILE=/absolute/path/to/firebase-service-account.json
```

不要把真实路径、服务账号 JSON 或密钥写入 `.env.example`。

### 5.2 必须带 FCM overlay 启动

```bash
cd deploy
docker compose \
  -f docker-compose.yml \
  -f docker-compose.fcm.yml \
  --profile im --profile full \
  up -d --build
```

`docker-compose.fcm.yml` 为 backend 注入：

- `IM_PUSH_ENABLED=true`
- `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json`
- 只读挂载服务账号 JSON

如果只运行基础 `docker-compose.yml`，backend 的默认 `IM_PUSH_ENABLED=false`，消息仍会保存，但 FCM 消费者不会启动。

### 5.3 Android 模拟器 API 连通性

移动端默认访问：

```text
http://10.0.2.2:8080/api
```

因此本地 Compose 的 backend 需要映射：

```yaml
ports:
  - "8080:8080"
```

它只用于本地开发。生产环境应通过 Caddy/Nginx 的 HTTPS 域名访问，不能把未受保护的 backend 端口直接暴露到公网。

## 6. 验证流程

### 6.1 启动检查

```bash
cd deploy
docker compose -f docker-compose.yml -f docker-compose.fcm.yml \
  --profile im --profile full ps backend

curl -sS http://127.0.0.1:8080/api/actuator/health
```

预期：backend 为 `Up`，健康接口返回 HTTP `200`。

检查运行时开关（不输出凭据）：

```bash
docker inspect rbac-backend --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | rg '^IM_PUSH_ENABLED=|^GOOGLE_APPLICATION_CREDENTIALS='
```

预期包含 `IM_PUSH_ENABLED=true`。

### 6.2 客户端登记检查

1. 启动 Android App，登录 admin。
2. 授予通知权限。
3. 用数据库只检查非敏感状态：`target_type=TOKEN`、`enabled=1`、`last_seen_at` 已刷新。
4. 不查询或打印 `target_value`。

### 6.3 端到端验证

1. 将 App 切到后台，不要强制停止。
2. 用 test 用户向 admin 发送一条普通文本消息。
3. 检查后端安全日志：

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.fcm.yml \
     --profile im --profile full logs --since 2m backend \
     | rg 'FCM batch|推送投递失败|进入死信'
   ```

4. 成功时会看到：

   ```text
   FCM batch delivered count=1
   ```

5. 模拟器应出现 `messages` 通知渠道的系统通知。

注意：FCM 返回“accepted/delivered”代表 FCM 网关接受或成功处理该请求；设备离线、网络限制和系统策略仍可能使最终显示延后。

## 7. 本次遇到的问题与解决方式

### 问题 A：Flyway 启动时 MySQL `Connection refused`

**现象**：`Communications link failure`，根因是 `java.net.ConnectException: Connection refused`。

**原因**：MySQL 尚未启动、端口不对，或后端先于数据库可用时启动。

**处理**：确认 MySQL 服务/容器健康、连接地址和端口正确后再启动后端。Flyway 能完成 schema validate/migrate 即表示数据库链路恢复。

### 问题 B：`PushRegistrationService` 没有默认构造器

**现象**：Spring 报 `No default constructor found`。

**原因**：该服务存在多个构造器，Spring 无法确定注入目标。

**处理**：给生产构造器增加 `@Autowired`，并确保 MyBatis mapper 被 `@Mapper` 和 `@MapperScan` 扫描。

### 问题 C：客户端登记 FID 后仍未收到推送

**现象**：服务端存在 `FID` 登记记录，但模拟器没有 FCM 回调或通知。

**处理**：客户端改为 `FirebaseMessaging.getInstance().token`，上传 `targetType=TOKEN`；后端原本已支持 `setToken`，无需变更接口协议。重新启动 App 后，服务端登记记录应更新为 `TOKEN`。

### 问题 D：消息已写入，但完全没有 FCM 投递日志

**现象**：Kafka `im-inbound` 被消费、消息写入成功，但 `im-push` 没有由 Docker 后端投递。

**原因 1**：重建 backend 时遗漏 `docker-compose.fcm.yml`，导致实际环境变量为 `IM_PUSH_ENABLED=false`，`PushCandidateConsumer` 不会创建。

**处理**：所有本地推送相关的启动、重启和重建命令都显式带上两个 Compose 文件。

**原因 2**：此前手工启动的本机 Spring Boot 后端加入了同一个 Kafka 消费组 `im-push-delivery`，抢占了 `im-push` 分区；Docker 后端显示 `partitions assigned: []`。

**处理**：停止旧本机 backend 进程，使 Docker backend 接管分区。可通过日志确认：

```text
im-push-delivery: partitions assigned: [im-push-0]
```

随后日志出现 `FCM batch delivered count=1`，模拟器成功展示通知。

### 问题 E：Android 登录页显示 `Network Error`

**现象**：停止本机后端后，模拟器登录请求失败。

**原因**：客户端固定请求 `10.0.2.2:8080`；本机后端曾经占用该端口，而 Docker backend 初始只在 Compose 内网暴露，没有映射宿主机 8080。

**处理**：在本地 `backend` Compose 服务增加 `8080:8080` 端口映射，重建后端后确认：

```bash
curl -sS http://127.0.0.1:8080/api/actuator/health
```

返回 `200` 后，模拟器可再次登录。

### 问题 F：Android 调试包提示不能连接 Metro

**现象**：日志含 `Cannot connect to Metro`。

**处理**：启动 Metro，并检查模拟器到 `10.0.2.2:8081` 的 TCP 连通性；必要时执行：

```bash
adb -s emulator-5554 reverse tcp:8081 tcp:8081
```

Metro 问题影响调试 JavaScript bundle 加载；API Network Error 则单独检查 `10.0.2.2:8080` 和 backend 端口映射，二者不要混淆。

## 8. 快速排查清单

按顺序检查，避免同时修改多个变量：

1. App 是否曾被“强制停止”？若是，先手动打开一次。
2. App 是否已登录、已授予通知权限？
3. `google-services.json` 的项目是否与服务账号 JSON 属于同一个 Firebase 项目？
4. backend 是否用 `docker-compose.fcm.yml` 启动，且 `IM_PUSH_ENABLED=true`？
5. backend 是否拥有 `im-push-0` 分区？是否有旧本机 backend 抢占同一消费组？
6. `im_push_registration` 是否存在近期、启用的 `TOKEN` 记录？
7. 后端日志是否出现 `FCM batch delivered count=1` 或明确错误码？
8. 模拟器是否能访问 `10.0.2.2:8080`？
9. App 在后台时，`dumpsys notification` 是否存在该包的通知记录？
10. 若网关已接受但设备迟迟未显示，检查 Google Play services、网络/防火墙、设备省电策略及 FCM TTL。

## 9. 安全要求

- 服务账号 JSON、私钥、registration token、JWT、数据库密码均视为敏感数据。
- `.env`、本机服务账号文件不提交 Git。
- 后端日志只记录批次结果和白名单错误码，不记录 token/FID、消息正文或完整 payload。
- 本地 `8080:8080` 映射仅用于开发；生产环境使用 HTTPS 反向代理、受限网络策略和受管密钥服务。
