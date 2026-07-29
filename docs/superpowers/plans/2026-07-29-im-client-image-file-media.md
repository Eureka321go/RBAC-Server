# IM 客户端图片与文件富媒体 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 React Native 客户端实现图片（拍照/相册）和文件消息，并通过 S3 Multipart Upload 支持达到 5 MiB 的对象跨应用、跨服务重启断点续传。

**Architecture:** Spring Boot 保存 Multipart 会话并只签发直传 URL；SDK Core 用 SQLite 保存上传任务并按服务端权威分片列表恢复；React Native 适配层承担选取、持久副本、分片读取和二进制传输；聊天页只编排用户交互和渲染。小文件复用单 PUT，大文件逐个上传 5 MiB 分片，完成对象后进入现有 outbox ACK/PUSH 发送链路。

**Tech Stack:** Java 21、Spring Boot 3.4、MyBatis-Plus、Flyway、AWS SDK v2 S3/MinIO、TypeScript、React Native 0.86、SQLite/op-sqlite、Axios、react-native-image-picker、@react-native-documents/picker、react-native-file-access、react-native-blob-util、react-native-file-viewer。

## Global Constraints

- 图片上限 10 MiB，文件上限 100 MiB；图片最长边 2048、质量 0.82，压缩后仍超限则拒绝。
- 小于 5 MiB 使用现有单 PUT；达到 5 MiB 使用 S3 Multipart，分片大小固定 5 MiB且顺序上传。
- Spring Boot 不接收文件字节；所有对象均由客户端通过预签名 URL 直传 MinIO/S3。
- MongoDB 消息正文只保存 `objectKey` 和元数据，不保存本地 URI，不持久化临时 GET URL。
- 应用进程被杀死时不继续后台传输；下一次启动、登录恢复或网络恢复时从缺失分片继续。
- 保留现有账号切换清理与 SQLite 隔离语义。
- 依照用户的既有约定，不新增或代跑自动化测试；只做 TypeScript 检查、跳过测试的 Maven 构建、diff 检查和手测清单。
- 提交标题使用中文，只提交本地分支，不 push。

---

### Task 1: 后端持久化 Multipart 会话与 S3 存储端口

**Files:**
- Create: `backend/src/main/resources/db/migration/V5__im_media_upload.sql`
- Create: `backend/src/main/java/com/rbac/im/entity/ImMediaUpload.java`
- Create: `backend/src/main/java/com/rbac/im/mapper/ImMediaUploadMapper.java`
- Modify: `backend/src/main/java/com/rbac/im/config/MediaProperties.java`
- Modify: `backend/src/main/java/com/rbac/im/service/MediaStorage.java`
- Modify: `backend/src/main/java/com/rbac/im/service/S3MediaStorage.java`
- Modify: `backend/src/main/resources/application.yml`

**Interfaces:**
- Produces: `MultipartSession createMultipart(String objectKey, String contentType)`、`String presignUploadPart(...)`、`List<UploadedPart> listParts(...)`、`void completeMultipart(...)`、`void abortMultipart(...)`。
- Produces: MySQL `im_media_upload`，状态固定为 `UPLOADING/COMPLETED/ABORTED/EXPIRED`。

- [ ] **Step 1: 新增 Flyway 表和实体映射**

```sql
CREATE TABLE `im_media_upload` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_id` VARCHAR(36) NOT NULL,
  `owner_id` BIGINT NOT NULL,
  `cid` VARCHAR(64) NOT NULL,
  `message_type` VARCHAR(16) NOT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `mime` VARCHAR(128) NOT NULL,
  `total_size` BIGINT NOT NULL,
  `part_size` BIGINT NOT NULL,
  `object_key` VARCHAR(512) NOT NULL,
  `upload_id` VARCHAR(1024) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_im_media_task` (`task_id`),
  KEY `idx_im_media_owner_status` (`owner_id`, `status`),
  KEY `idx_im_media_expires` (`status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 富媒体分片上传会话';
```

- [ ] **Step 2: 扩展媒体配置**

```java
private long multipartThreshold = 5L * 1024 * 1024;
private long multipartPartSize = 5L * 1024 * 1024;
private long multipartSessionTtlSeconds = 86400;
private long cleanupDelayMs = 300000;
```

- [ ] **Step 3: 扩展存储端口和 S3 实现**

```java
record MultipartSession(String uploadId) {}
record UploadedPart(int partNumber, String eTag, long size) {}
MultipartSession createMultipart(String objectKey, String contentType);
String presignUploadPart(String objectKey, String uploadId, int partNumber,
                         long contentLength, Duration ttl);
List<UploadedPart> listParts(String objectKey, String uploadId);
void completeMultipart(String objectKey, String uploadId, List<UploadedPart> parts);
void abortMultipart(String objectKey, String uploadId);
```

- [ ] **Step 4: 静态编译并提交**

Run: `mvn -f backend/pom.xml -Dmaven.test.skip=true package`

Expected: `BUILD SUCCESS`

```bash
git add backend/src/main/resources/db/migration/V5__im_media_upload.sql backend/src/main/java/com/rbac/im/entity/ImMediaUpload.java backend/src/main/java/com/rbac/im/mapper/ImMediaUploadMapper.java backend/src/main/java/com/rbac/im/config/MediaProperties.java backend/src/main/java/com/rbac/im/service/MediaStorage.java backend/src/main/java/com/rbac/im/service/S3MediaStorage.java backend/src/main/resources/application.yml
git commit -m "功能(IM后端)：支持富媒体分片存储会话"
```

### Task 2: 后端 Multipart 编排、下载 URL 刷新与过期清理

**Files:**
- Create: `backend/src/main/java/com/rbac/im/dto/MultipartInitRequest.java`
- Create: `backend/src/main/java/com/rbac/im/dto/DownloadPresignRequest.java`
- Create: `backend/src/main/java/com/rbac/im/vo/MultipartInitResult.java`
- Create: `backend/src/main/java/com/rbac/im/vo/MultipartStatusResult.java`
- Create: `backend/src/main/java/com/rbac/im/vo/UploadPartPresignResult.java`
- Create: `backend/src/main/java/com/rbac/im/vo/DownloadPresignResult.java`
- Create: `backend/src/main/java/com/rbac/im/service/MultipartMediaService.java`
- Create: `backend/src/main/java/com/rbac/im/service/MediaUploadCleanupJob.java`
- Modify: `backend/src/main/java/com/rbac/im/controller/ImUploadController.java`
- Modify: `backend/src/main/java/com/rbac/RbacServerApplication.java`
- Modify: `backend/src/main/java/com/rbac/im/service/MediaService.java`
- Modify: `backend/src/main/resources/i18n/messages.properties`
- Modify: `backend/src/main/resources/i18n/messages_en_US.properties`
- Modify: `backend/src/main/resources/i18n/messages_zh_CN.properties`

**Interfaces:**
- Consumes: Task 1 `MediaStorage` Multipart 方法与 `ImMediaUploadMapper`。
- Produces: `init/status/presignPart/complete/abort` 服务方法和 `/im/upload/multipart/**` REST API。
- Produces: `POST /im/upload/download/presign`，返回 `{objectKey,url,expiresIn}`。

- [ ] **Step 1: 定义请求/响应 DTO**

```java
public record MultipartInitResult(String taskId, String objectKey, long partSize,
                                  int partCount, long expiresAt) {}
public record UploadedPartResult(int partNumber, String eTag, long size) {}
public record MultipartStatusResult(String taskId, String objectKey, String status,
                                    long partSize, int partCount,
                                    List<UploadedPartResult> uploadedParts) {}
public record UploadPartPresignResult(int partNumber, String uploadUrl, long expiresIn) {}
public record DownloadPresignResult(String objectKey, String url, long expiresIn) {}
```

- [ ] **Step 2: 实现所有者、成员、大小和分片校验**

`init` 复用 `MediaService` 的类型/MIME/大小与 objectKey 生成规则；其余操作必须同时满足 `ownerId == currentUserId`、任务为 `UPLOADING`、用户仍为当前会话成员。合法 `partNumber` 范围为 `1..ceil(totalSize/partSize)`，每片申报长度由服务端根据总大小计算。

- [ ] **Step 3: 完成与取消采用权威 S3 列表**

```java
List<MediaStorage.UploadedPart> parts = storage.listParts(row.getObjectKey(), row.getUploadId());
validateCompleteParts(row, parts);
storage.completeMultipart(row.getObjectKey(), row.getUploadId(), parts);
row.setStatus("COMPLETED");
mapper.updateById(row);
```

- [ ] **Step 4: 刷新下载 URL并清理过期会话**

下载签名前验证 `objectKey` 匹配 `^im/<quoted cid>/...` 且对象存在。启用 `@EnableScheduling`；每 5 分钟查询过期 `UPLOADING` 行，逐条尽力 abort 后标记 `EXPIRED`。

- [ ] **Step 5: 静态编译并提交**

Run: `mvn -f backend/pom.xml -Dmaven.test.skip=true package`

Expected: `BUILD SUCCESS`

```bash
git add backend/src/main/java/com/rbac backend/src/main/resources/i18n
git commit -m "功能(IM后端)：增加富媒体断点续传接口"
```

### Task 3: SDK Core 媒体任务存储、状态机与媒体发送

**Files:**
- Modify: `im-client/packages/im-sdk-core/src/ports/index.ts`
- Modify: `im-client/packages/im-sdk-core/src/store/migrations.ts`
- Create: `im-client/packages/im-sdk-core/src/media/mediaTypes.ts`
- Create: `im-client/packages/im-sdk-core/src/media/mediaUploadStore.ts`
- Create: `im-client/packages/im-sdk-core/src/media/mediaUploadService.ts`
- Modify: `im-client/packages/im-sdk-core/src/chat/chatService.ts`
- Modify: `im-client/packages/im-sdk-core/src/engine/syncEngine.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`

**Interfaces:**
- Produces: `MediaSourcePort`、`MediaBinaryPort`、`MediaOpenPort`。
- Produces: `MediaUploadService.enqueue/retry/cancel/resumeAll/listByCid/refreshDownloadUrl/downloadAndOpen`。
- Produces: `ChatService.sendMedia(cid, type, body, clientMsgId)`。

- [ ] **Step 1: 定义媒体类型和端口**

```ts
export interface PickedMedia {
  uri: string; filename: string; mime: string; size: number;
  width?: number; height?: number;
}
export interface MediaBinaryPort {
  persist(source: PickedMedia, taskId: string): Promise<PickedMedia>;
  exists(uri: string): Promise<boolean>;
  readChunkBase64(uri: string, offset: number, length: number): Promise<string>;
  putBase64(url: string, base64: string, contentType: string): Promise<{ eTag: string | null }>;
  download(url: string, filename: string, onProgress: (done: number, total: number) => void): Promise<string>;
  remove(uri: string): Promise<void>;
}
export interface MediaOpenPort { open(uri: string, mime: string): Promise<void>; }
```

- [ ] **Step 2: 新增 SQLite 迁移和存储类**

表 `media_upload_task` 使用 `task_id` 主键，保存 `client_msg_id/account_id/cid/type/local_uri/filename/mime/size/width/height/mode/server_task_id/object_key/part_size/status/progress/error/created_at/updated_at`。存储类提供 `insert/get/listByCid/listResumable/update/delete`，所有 JSON/数字转换集中在该文件。

- [ ] **Step 3: 实现大小分流和续传状态机**

```ts
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;
if (task.size < MULTIPART_THRESHOLD) await uploadSingle(task);
else await uploadMultipart(task);
await chat.sendMedia(task.cid, task.type, mediaBody(task), task.clientMsgId);
```

Multipart 恢复先 `GET status`，跳过已存在 partNumber，只顺序读取并上传缺失分片；403/过期 URL 只重新签当前分片。上传并发由服务内单一 Promise 队列串行化，避免同一任务重复恢复。

- [ ] **Step 4: 合并上传任务与聊天消息**

`getChatMessages` 将 `media_upload_task` 投影为 `status='uploading'|'failed'` 的本机消息，并与 persisted/outbox 按时间排序。上传完成进入 outbox 后删除媒体任务，使用同一个 `clientMsgId` 避免 UI 重复。

- [ ] **Step 5: 类型检查并提交**

Run: `npx tsc -p packages/im-sdk-core --noEmit`

Expected: exit code 0

```bash
git add im-client/packages/im-sdk-core
git commit -m "功能(IM SDK)：持久化并恢复富媒体上传任务"
```

### Task 4: React Native 媒体适配器与 SDK 装配

**Files:**
- Modify: `im-client/packages/app-mobile/package.json`
- Modify: `im-client/package-lock.json`
- Modify: `im-client/packages/app-mobile/ios/Podfile`
- Modify: `im-client/packages/app-mobile/ios/AppMobile/Info.plist`
- Modify: `im-client/packages/app-mobile/android/app/src/main/AndroidManifest.xml`
- Modify: `im-client/packages/im-sdk-rn/package.json`
- Create: `im-client/packages/im-sdk-rn/src/adapters/rnMediaPicker.ts`
- Create: `im-client/packages/im-sdk-rn/src/adapters/rnMediaBinary.ts`
- Create: `im-client/packages/im-sdk-rn/src/adapters/rnMediaOpener.ts`
- Modify: `im-client/packages/im-sdk-rn/src/createSdk.ts`
- Modify: `im-client/packages/im-sdk-rn/src/index.ts`

**Interfaces:**
- Consumes: Task 3 端口和 `MediaUploadService`。
- Produces: `sdk.media`，以及 `pickCameraImage/pickLibraryImage/pickFile`。

- [ ] **Step 1: 安装原生依赖并配置权限**

Run from `im-client`:

```bash
npm install --workspace app-mobile react-native-image-picker @react-native-documents/picker react-native-file-access react-native-blob-util react-native-file-viewer
```

iOS 添加 `NSCameraUsageDescription` 和 `NSPhotoLibraryUsageDescription`；Podfile 设置 `$RNFANoPrivacyAPI = true`。Android 不主动声明 CAMERA，以遵循 image-picker 的系统相机权限模型；文件打开所需 FileProvider 由依赖 manifest 合并。

- [ ] **Step 2: 实现拍照/相册/文件选择与持久副本**

图片选项固定 `{mediaType:'photo', maxWidth:2048, maxHeight:2048, quality:0.82, selectionLimit:1}`。文档选择后立刻复制到应用 Documents 目录；任何临时 URI 在任务入库前转换为应用持久 URI。

- [ ] **Step 3: 实现分片 PUT、下载和系统打开**

`readFileChunk(..., 'base64')` 每次只读取一个分片；`react-native-blob-util.fetch('PUT', url, {'Content-Type':'application/octet-stream'}, base64)` 上传并从响应头提取 ETag。下载写入 cache，文件名经过 basename 清洗；打开失败映射 `NO_FILE_HANDLER`。

- [ ] **Step 4: 装配并类型检查**

Run: `npx tsc -p packages/im-sdk-core --noEmit && npx tsc -p packages/app-mobile --noEmit`

Expected: both exit code 0

```bash
git add im-client/package-lock.json im-client/packages/im-sdk-rn im-client/packages/app-mobile/package.json im-client/packages/app-mobile/ios im-client/packages/app-mobile/android
git commit -m "功能(IM客户端)：接入图片文件原生能力"
```

### Task 5: 聊天页附件交互、媒体气泡与全屏预览

**Files:**
- Create: `im-client/packages/app-mobile/src/components/AttachmentPickerSheet.tsx`
- Create: `im-client/packages/app-mobile/src/components/MediaMessageContent.tsx`
- Create: `im-client/packages/app-mobile/src/components/ImagePreviewModal.tsx`
- Create: `im-client/packages/app-mobile/src/media/mediaPresentation.ts`
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/ui/theme.ts`

**Interfaces:**
- Consumes: `sdk.media` 与扩展后的 `ChatMessage` 上传状态/进度。
- Produces: 相机、相册、文件三个入口；图片/文件气泡；重试、取消、下载、打开和全屏预览。

- [ ] **Step 1: 增加附件面板**

输入栏发送按钮左侧增加 `add-circle-outline`。底部面板只含“拍照 / 相册 / 文件”，选择完成后立即关闭并调用 `sdk.media.enqueue(cid, type, picked)`。

- [ ] **Step 2: 按消息类型渲染内容**

```tsx
switch (message.type) {
  case 'IMAGE': return <ImageMessage message={message} onPreview={setPreview} />;
  case 'FILE': return <FileMessage message={message} onOpen={openFile} />;
  default: return <MentionText body={message.body} />;
}
```

图片最大宽 220、高 280，按元数据宽高等比布局；文件卡片显示安全文件名和 `formatBytes(size)`。上传中覆盖百分比和进度条；失败气泡复用红色重试图标并允许取消。

- [ ] **Step 3: 临时 URL 刷新和预览/打开**

图片首次使用消息中的 `url`，`onError` 最多调用一次 `refreshDownloadUrl`。全屏 Modal 使用黑色背景和 `resizeMode='contain'`。文件点击时先获取新 URL，再下载并显示进度，最后调用系统打开。

- [ ] **Step 4: 错误文案与现有撤回/已读兼容**

映射 `MEDIA_TOO_LARGE/UPLOAD_SOURCE_MISSING/UPLOAD_SESSION_EXPIRED/UPLOAD_FAILED/DOWNLOAD_FAILED/NO_FILE_HANDLER/NOT_MEMBER` 为中文横幅。已发送媒体继续使用现有长按撤回；单聊媒体继续显示已读/已发送。

- [ ] **Step 5: 类型检查并提交**

Run: `npx tsc -p packages/app-mobile --noEmit`

Expected: exit code 0

```bash
git add im-client/packages/app-mobile/src
git commit -m "功能(IM客户端)：展示并操作图片文件消息"
```

### Task 6: 全量静态验证、差异审查与交接更新

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`

**Interfaces:**
- Consumes: Tasks 1–5 完整链路。
- Produces: 可复现的环境说明和用户手测清单。

- [ ] **Step 1: 执行允许的静态验证**

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
cd ..
mvn -f backend/pom.xml -Dmaven.test.skip=true clean package
mvn -f im-gateway/pom.xml -Dmaven.test.skip=true package
git diff --check
```

Expected: all exit code 0；不运行 Jest、Vitest、JUnit 或 E2E。

- [ ] **Step 2: 审查安全与状态边界**

确认 diff 不包含本地路径、token、MinIO 密钥新增值或消息正文中的临时 GET URL；确认 Multipart 完成使用服务端 ListParts；确认账号切换不恢复其他账号任务。

- [ ] **Step 3: 更新交接并提交**

```bash
git add docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md
git commit -m "文档(IM客户端)：记录图片文件富媒体开发状态"
```

- [ ] **Step 4: 向用户交付手测清单**

只报告改动结果、静态验证结果和设计文档“验证标准”列出的手测场景；明确没有主动 push。
