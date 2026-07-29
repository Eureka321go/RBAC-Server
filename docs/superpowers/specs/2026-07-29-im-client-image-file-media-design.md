# IM 客户端图片与文件富媒体设计

> 状态：用户已确认方案并授权直接实施（2026-07-29）。本期同时修改后端、SDK Core、React Native 适配层和移动端应用。

## 目标与范围

本期打通图片与文件消息的完整闭环：图片可拍照或从相册选择，文件可从系统文档选择；上传后发送 `IMAGE` / `FILE` 消息；图片在聊天气泡中展示并可全屏预览，文件可下载并交给系统应用打开。

图片选择时自动压缩到最长边 2048、质量 0.8；压缩后仍超过服务端 10 MiB 限制则提示重新选择。文件沿用服务端 100 MiB 上限。小于 5 MiB 的对象继续走现有单次预签名 PUT，达到 5 MiB 的对象走真正的 S3 Multipart Upload。上传任务持久化，应用重启或网络恢复后只补传缺失分片。应用进程被系统杀死期间不承诺继续上传。

语音、视频、拍照后保存到公共相册、后台原生上传任务和链接卡片不在本期范围内。

## 总体架构

富媒体能力拆成四个边界清晰的部分：

1. 后端媒体会话负责签发单次上传地址、创建和恢复 Multipart 会话、签发分片地址、完成或取消会话，以及刷新下载地址。
2. SDK Core 的媒体上传服务负责任务状态机、SQLite 持久化、大小分流、恢复缺失分片、完成对象后发送消息。
3. React Native 适配层负责图片/文件选择、把临时 URI 复制到应用持久目录、按偏移读取分片、上传二进制、下载和调用系统应用打开。
4. 移动端聊天页负责附件入口、上传进度/失败重试、图片气泡、全屏预览和文件卡片。

客户端始终直传 MinIO/S3，Spring Boot 不中转文件字节。消息体只保存对象引用和权威元数据，不保存本地路径；临时 GET URL 也不持久化到 MongoDB。

## 后端 Multipart API

保留现有 `POST /api/im/upload/presign` 兼容小文件，并新增：

- `POST /api/im/upload/multipart/init`：校验会话成员、类型、MIME 和大小，创建 S3 Multipart Upload，返回服务端任务 ID、`objectKey`、5 MiB `partSize`、`partCount` 和过期时间。
- `GET /api/im/upload/multipart/{taskId}`：仅任务所有者可查询，返回状态和 S3 已存在分片的 `partNumber/etag/size`，作为恢复时的权威依据。
- `POST /api/im/upload/multipart/{taskId}/parts/{partNumber}/presign`：校验分片编号和任务状态后签发单个 UploadPart URL。
- `POST /api/im/upload/multipart/{taskId}/complete`：服务端从 S3 读取权威分片列表，验证连续编号、总大小和非末片最小大小，再完成对象并返回 `objectKey`。
- `DELETE /api/im/upload/multipart/{taskId}`：取消任务并调用 AbortMultipartUpload。
- `POST /api/im/upload/download/presign`：校验当前用户仍是会话成员且 `objectKey` 属于该会话，返回新的临时 GET URL。

后端用 MySQL `im_media_upload` 记录任务所有者、会话、对象键、S3 uploadId、类型、MIME、总大小、分片大小、状态和过期时间。这样客户端和服务端任一方重启都能恢复。定时清理过期任务时先 abort S3 Multipart，再标记过期，避免遗留计费分片。

## 客户端任务与状态机

SQLite 新增 `media_upload_task`，记录本地任务 ID、`clientMsgId`、账号、会话、消息类型、本地持久 URI、文件名、MIME、大小、上传模式、服务端任务 ID、对象键、分片大小、状态、进度、错误和时间戳。账号切换时沿用现有隔离规则，停止旧账号任务且不向新账号暴露其本地记录。

状态流为：

`queued -> preparing -> uploading -> completing -> sending -> sent`

失败进入 `failed`，保留可恢复信息；用户点击重试后从服务端查询已上传分片并回到 `uploading`。取消进入 `cancelled`，后端 abort 后删除本地副本。完成对象后，SDK 使用同一 `clientMsgId` 写入现有 outbox 并发送媒体消息，最终仍由 ACK/PUSH 链路结算。发送成功后清理上传任务和发送端本地副本。

每次只上传一个 5 MiB 分片，避免多个 base64 分片同时占用 JS 内存。分片 ETag 从对象存储响应读取，但完成时以后端 `ListParts` 为准。启动完成、登录恢复和网络重新连通时扫描 `queued/uploading/completing/failed(auto-retryable)` 任务；文件存在且账号匹配才自动恢复。

## React Native 依赖与端口

- `react-native-image-picker`：`launchCamera` / `launchImageLibrary`，只选图片并使用尺寸与质量参数压缩。
- `@react-native-documents/picker`：选择文件并复制到应用 Documents 目录，避免 `content://` 权限或系统临时文件在重启后失效。
- `react-native-file-access`：持久文件复制、存在性/大小检查、`readFileChunk` 分片读取和下载。
- `react-native-blob-util`：把 base64 分片作为二进制 PUT 到预签名 URL并读取 ETag。
- `react-native-file-viewer`：把下载完成的文件交给系统应用打开。

SDK Core 只依赖抽象端口，不直接导入 React Native 包。端口覆盖媒体选择、持久化本地副本、按偏移读取、二进制 PUT、下载和系统打开，便于替换具体原生库。

## 消息体与展示

发送 `IMAGE`：

```json
{
  "objectKey": "im/c_1_2/202607/uuid.jpg",
  "filename": "photo.jpg",
  "mime": "image/jpeg",
  "size": 123456,
  "width": 1440,
  "height": 1080
}
```

发送 `FILE`：

```json
{
  "objectKey": "im/c_1_2/202607/uuid.pdf",
  "filename": "report.pdf",
  "mime": "application/pdf",
  "size": 123456
}
```

服务端继续以 HEAD 结果覆盖 `size/mime`。图片气泡按最大宽高等比展示，加载中显示占位，失败时刷新一次 GET URL；点击进入全屏 `contain` 预览。文件卡片显示文件名、格式图标和易读大小；点击时总是先刷新 GET URL，下载到应用缓存并显示进度，完成后调用系统应用打开。

现有 SQLite 会保存 PUSH/PULL 中的短期 URL，因此渲染不能假定旧 URL 永久有效。图片加载失败和文件下载前都通过下载预签名接口刷新，刷新结果只放在当前 UI/下载状态中，不回写 MongoDB。

## 错误、安全与清理

- 所有 Multipart 接口同时校验登录用户、会话成员身份、任务所有权和对象键前缀。
- 后端限制合法分片编号、单任务并发签名数量、总大小和 MIME；完成前用 S3 权威数据复核，不能信任客户端 ETag 或进度。
- 预签名 URL 过期时重新签发当前分片，不重新创建整个任务。
- 成员退出、源文件丢失、对象不存在、空间不足、权限拒绝和无系统应用可打开都显示明确中文提示。
- 用户取消、发送成功和过期清理会删除不再需要的本地副本；下载缓存采用可重建数据，允许按时间清理。
- 服务端错误码映射为稳定 reason，UI 不直接展示底层异常和存储地址。

## 验证标准

遵循当前项目约定，本期不新增或代跑自动化测试。实现后只执行 TypeScript 类型检查、相关 Maven 跳过测试构建和 `git diff --check`，并交付手测清单。

手测至少覆盖：拍照与相册图片、图片压缩/超限、大小文件分流、上传进度、断网后续传、应用重启后续传、取消与重试、双端实时和离线展示、临时 URL 过期刷新、全屏预览、文件下载/打开、无可用打开应用、成员退出、账号切换隔离，以及发送后撤回图片/文件。
