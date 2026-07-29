# IM 富媒体（里程碑 6）设计方案 — Phase 4

> 状态：已通过头脑风暴评审（2026-07-24）。上游总方案见 `2026-07-22-im-chat-mvp-design.md`「消息类型与富媒体上传」节。
> 前置：里程碑 1–5（基建 / 握手鉴权 / 单聊闭环 / 离线多端同步 / 群聊）已完成，分支 `feat/im`。

## 目标与范围

在现有 IM 后端上加**富媒体消息**：图片 `IMAGE` / 音频 `AUDIO` / 文件 `FILE`，走 **MinIO 预签名直传**——客户端直传对象存储，业务服务器不中转字节，消息体只存对象引用。

**做**：预签名 PUT 上传接口、三种媒体消息类型的发送校验与落库、读取时预签名 GET 回显、启动建桶。
**不做**（明确排除，YAGNI）：
- **图片缩略图**：客户端自缩；`thumbKey` 字段预留但本期不填，后续可补异步生成。
- **链接卡片 / OG 抓取**：属里程碑 7（含 SSRF 防护），本期不涉及任何用户提供 URL 的抓取。
- **富媒体 GC**：撤回/删除后的对象回收留后续。
- **im-gateway 改动**：媒体消息只是 `type=IMAGE/AUDIO/FILE` 的普通 Envelope，网关原样转发到 Kafka，无需改动。

## 决策记录（头脑风暴结论）

- **S3 客户端**：AWS SDK v2（`software.amazon.awssdk:s3` + `s3-presigner`）。通过 endpoint override 同时支持 MinIO 与阿里云 OSS，切生产只换 endpoint/凭证；`S3Presigner` 专责预签名，职责分明。
- **缩略图**：本期不做，客户端自缩（IMAGE body 带 width/height，客户端拉原图自行缩放）。
- **objectKey 校验强度**：结构校验（前缀绑定 `im/{cid}/`）+ `HEAD`（headObject）确认对象真实存在，并用 HEAD 返回的 size/contentType 回填 body（不信客户端自报）。
- **配置前缀**：`rbac.im.media`；预签名默认 TTL：PUT 5 分钟、GET 5 分钟。

---

## 架构与组件边界

核心思想：把对象存储访问抽成**端口接口 `MediaStorage`**，校验/回填逻辑与 AWS SDK 解耦——逻辑单测 mock 端口，一个集成测跑真实实现连本地 MinIO。

| 层 | 组件 | 职责 |
|----|------|------|
| 表现 | `ImUploadController` | `POST /api/im/upload/presign` → 校验后发预签名 PUT URL |
| 表现 | `MessageQueryService`（改） | `pull` 时经 `MediaUrlEnricher` 把 objectKey 换成预签名 GET URL（`toVo` 注入点） |
| 逻辑 | `MediaService` | 白名单/大小校验、生成 objectKey、发预签名 PUT、发送时结构校验 + HEAD 回填 |
| 逻辑 | `InboundMessageConsumer`（改） | 收到媒体类型消息 → 委托 `MediaService` 校验+回填 → 通过则 `MessageAppender.append` |
| 逻辑 | `MediaUrlEnricher` | 给媒体 body 附加临时 GET `url`（push 与 pull 共用，一次签名全体共用） |
| 端口 | `MediaStorage`（interface） | `presignPut / presignGet / stat / ensureBucket` |
| 端口 | `S3MediaStorage` | `MediaStorage` 的 AWS SDK v2 实现（endpoint override → MinIO/OSS 通吃） |

**边界说明**：
- `MediaStorage` 是唯一接触 S3 SDK 的地方；其余组件只依赖该接口，不感知 MinIO/AWS。
- `MediaUrlEnricher` 单一职责：输入 `(type, body)`，输出附加了临时 `url` 的 body 副本；非媒体类型原样返回。被 push 路径（`MessageAppender`）与 pull 路径（`MessageQueryService`）共用，保证在线/离线回显一致。
- 持久化的 MongoDB body **只存 objectKey 及元数据，绝不存 url**（url 有 TTL，不可持久化）；url 只在序列化给客户端的瞬间临时签发。

---

## 数据流

### 1. 上传（预签名 PUT）
```
POST /api/im/upload/presign   body: { cid, type, filename, mime, size }
  → 校验：请求者是 cid 成员；mime 在该 type 白名单；size ≤ 该 type 上限
  → objectKey = im/{cid}/{yyyyMM}/{uuid}.{ext}
  → MediaStorage.presignPut(objectKey, put-ttl)
  ← { objectKey, uploadUrl, expiresIn }
客户端用 uploadUrl 直传 MinIO（不经业务服务器）
```

### 2. 发消息（上行，复用 WS → Kafka → InboundMessageConsumer）
消息 `type=IMAGE/AUDIO/FILE`，`body = { objectKey, ...按类型元数据 }`。
```
InboundMessageConsumer.onMessage:
  幂等判重（已有）
  成员校验 / 群禁言拦截（已有 Task 3）
  若 type ∈ {IMAGE,AUDIO,FILE}:
    MediaService.validateAndEnrich(cid, body):
      ① objectKey 前缀必须 == "im/{cid}/"        → 否则 ERROR(reason=INVALID_OBJECT)
      ② MediaStorage.stat(objectKey) 存在?         → 否则 ERROR(reason=OBJECT_NOT_FOUND)
      ③ 用 HEAD 的 size/contentType 回填 body（覆盖客户端自报）
  MessageAppender.append(cid, sender, type, body, clientMsgId)   // 落库 + 扇出（已有）
```
校验不过 → 丢弃并回 ERROR 帧（复用 `OutboundDispatcher.dispatchToUser`）。

### 3. 读回显（在线推 + 离线拉，共用 enricher）
```
MongoDB 存: body = { objectKey, size, mime, ...(无 url) }
Pull:  MessageQueryService.toVo → MediaUrlEnricher.enrich(type, body) → body 追加 url(GET,短TTL)
Push:  MessageAppender 扇出前 → MediaUrlEnricher.enrich → 推给在线成员的 body 带 url
```
在线成员收到即用；离线成员上线 `pull` 时重新签发新鲜 url，天然规避 TTL 过期。

---

## 消息 body 结构（按类型）

| 类型 | 客户端上报 body | 服务端回填/回显补充 |
|------|----------------|--------------------|
| IMAGE | `objectKey, width, height` | HEAD 回填 `size, mime`；回显加 `url` |
| AUDIO | `objectKey, duration` | HEAD 回填 `size, mime`；回显加 `url` |
| FILE | `objectKey, filename` | HEAD 回填 `size, mime`；回显加 `url` |

> `thumbKey` / `thumbUrl` 本期不产出（缩略图延后）。

---

## 存储与配置

**MinIO 桶**：`im-media`（私有）；应用启动时 `MediaStorage.ensureBucket` 不存在则创建。
**objectKey 约定**：`im/{cid}/{yyyyMM}/{uuid}.{ext}`（uuid 用 `UUID.randomUUID()` 十六进制，避免新增 ULID 依赖；唯一性足够）。

**配置 `rbac.im.media`（application.yml，本地凭证对齐 compose，仅本地）**：
```yaml
rbac:
  im:
    media:
      endpoint: http://localhost:9000
      access-key: rbac
      secret-key: rbac123456
      bucket: im-media
      region: us-east-1        # MinIO 占位 region
      put-ttl-seconds: 300
      get-ttl-seconds: 300
      limits:
        image: { max-size: 10485760,  mimes: [image/jpeg, image/png, image/gif, image/webp] }
        audio: { max-size: 20971520,  mimes: [audio/mpeg, audio/mp4, audio/aac, audio/ogg, audio/wav] }
        file:  { max-size: 104857600, mimes: ["*"] }   # 文件放开 mime，仅限大小
```
（上限：图 10MB / 音 20MB / 文件 100MB，可后续调。`file` mime 白名单用 `*` 表示不限类型。）

---

## 安全

- 全程私有桶 + 短 TTL 预签名 URL（PUT 上传 / GET 回显），不开公开读。
- objectKey 前缀绑定 `im/{cid}/` + 会话成员校验，防跨会话引用/盗用他人对象。
- HEAD 确认对象真实存在且回填权威 size/mime，杜绝伪造元数据与断链引用。
- 本里程碑不抓取任何用户提供的 URL，**无 SSRF 面**（SSRF 防护属里程碑 7 链接卡片）。
- 凭证仅本地，不带入生产（生产切阿里云 OSS 换 endpoint/凭证）。

---

## 测试策略

沿用 `@SpringBootTest @ActiveProfiles("test")`（连真实 MySQL/Redis/MongoDB）。存储端口用 `@MockBean MediaStorage` 隔离 SDK，另加一个真实 MinIO 集成测。

1. **presign 接口**（MockMvc + mock MediaStorage）：非成员拒（403）；mime 不在白名单拒；size 超限拒；正常返回 `objectKey` 前缀 `im/{cid}/` + `uploadUrl`。
2. **媒体发送校验**（mock MediaStorage）：错误 cid 前缀 → ERROR(INVALID_OBJECT) 且不落库；HEAD 不存在 → ERROR(OBJECT_NOT_FOUND) 且不落库；正常 → 落库且 body 的 size/mime 被 HEAD 值回填。
3. **读回显 enricher**：IMAGE 消息 pull 后 body 含 `url`；TEXT/SYSTEM 消息 body 不含 `url`（enricher 对非媒体 no-op）。
4. **S3 集成测**（真实 MinIO，profile im 已起）：`ensureBucket` → `presignPut` → HTTP PUT 上传字节 → `stat` 得到正确 size/contentType → `presignGet` → HTTP GET 取回字节一致。

---

## 里程碑收尾

- 全量 IM 测试 + 全模块 `mvn package` 全绿。
- 在总方案 `2026-07-22-im-chat-mvp-design.md` 里程碑 6 旁标注完成。
- 分支仍为 `feat/im`（长期干线，见记忆 im-integration-branch）。
