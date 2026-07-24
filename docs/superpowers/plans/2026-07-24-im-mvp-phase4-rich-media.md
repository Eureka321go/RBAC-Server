# IM 富媒体（里程碑 6）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 IM 后端加图片/音频/文件富媒体消息，走 MinIO 预签名直传（客户端直传对象存储，服务器不中转字节，消息只存对象引用）。

**Architecture:** 把对象存储访问抽成端口接口 `MediaStorage`（唯一接触 AWS SDK 处），`S3MediaStorage` 为 AWS SDK v2 实现（endpoint override → MinIO/OSS 通吃）。`MediaService` 承载上传预签名与发送校验；`MediaUrlEnricher` 在 push（`MessageAppender`）与 pull（`MessageQueryService`）两条读路径共用，把持久化的 objectKey 临时换成预签名 GET URL。持久化 body 只存 objectKey+元数据，绝不存 url。

**Tech Stack:** Java 21 + Spring Boot 3.4.1 + AWS SDK v2 (s3，内含 presigner) + MinIO(S3 兼容) + MyBatis-Plus + MongoDB + Redis + Kafka；测试 `@SpringBootTest @ActiveProfiles("test")`，存储端口用 `@MockBean MediaStorage` 隔离，另加真实 MinIO 集成测。

## Global Constraints

- 统一响应 `com.rbac.common.Result<T>`；`Result.success(data)`。
- 统一异常 `com.rbac.common.exception.BusinessException(int code, String messageKey, Object... args)`；`GlobalExceptionHandler` 把它转成 **HTTP 200 + `Result{code,message}`**（不改 HTTP 状态）——故负向 MockMvc 断言用 `status().isOk()` + `jsonPath("$.code")`。文案 key 走 i18n（`src/main/resources/i18n/messages*.properties`，三份：`messages.properties`/`messages_en_US.properties` 英文，`messages_zh_CN.properties` 中文）。
- 当前用户：`com.rbac.common.util.SecurityUtils.getUserId()` → `Long`。
- 控制器统一 `@RequestMapping("/im/...")`（context-path `/api` 前缀由框架加）。
- 消息 `type` 富媒体三类固定字符串：`IMAGE`/`AUDIO`/`FILE`。
- objectKey 约定：`im/{cid}/{yyyyMM}/{uuidHex}{ext}`；持久化 body 不含 url。
- 配置前缀 `rbac.im.media`；预签名默认 TTL：PUT/GET 各 300 秒。
- 已有可复用签名：`MessageAppender.append(String cid, Long senderId, String type, Map<String,Object> body, String clientMsgId) -> long`；`ConversationService.isMember(String cid, long userId) -> boolean`；`OutboundDispatcher.dispatchToUser(long userId, Envelope env)`；`ImMessageRepository.findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, long since, Limit limit)`。
- im-gateway 模块**不改动**（媒体消息只是 `type=IMAGE/AUDIO/FILE` 的普通 Envelope，网关原样转发）。

---

### Task 1: AWS SDK 依赖 + `MediaProperties` 配置绑定

**Files:**
- Modify: `backend/pom.xml`（加 s3 依赖，内含 S3Presigner）
- Create: `backend/src/main/java/com/rbac/im/config/MediaProperties.java`
- Modify: `backend/src/main/resources/application.yml`（`rbac.im` 下加 `media` 子节点）
- Test: `backend/src/test/java/com/rbac/im/config/MediaPropertiesTest.java`

**Interfaces:**
- Produces:
  - `MediaProperties`：getter `getEndpoint/getAccessKey/getSecretKey/getBucket/getRegion()`、`getPutTtlSeconds()->long`、`getGetTtlSeconds()->long`、`getLimits()->Map<String,MediaProperties.Limit>`；方法 `MediaProperties.Limit limitFor(String type)`。
  - `MediaProperties.Limit`：`getMaxSize()->long`、`getMimes()->List<String>`。

- [ ] **Step 1: 写失败测试**

创建 `MediaPropertiesTest.java`：

```java
package com.rbac.im.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class MediaPropertiesTest {

    @Autowired MediaProperties props;

    @Test
    void binds_bucket_ttl_and_limits() {
        assertThat(props.getBucket()).isEqualTo("im-media");
        assertThat(props.getPutTtlSeconds()).isEqualTo(300);
        assertThat(props.limitFor("IMAGE")).isNotNull();
        assertThat(props.limitFor("IMAGE").getMaxSize()).isEqualTo(10485760L);
        assertThat(props.limitFor("IMAGE").getMimes()).contains("image/png");
        assertThat(props.limitFor("FILE").getMimes()).contains("*");
        assertThat(props.limitFor("UNKNOWN")).isNull();
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=MediaPropertiesTest`
Expected: 编译失败——`MediaProperties` 不存在。

- [ ] **Step 3: 加 AWS SDK 依赖**

在 `backend/pom.xml` 的 spring-kafka 依赖之后、Lombok 之前插入（版本显式固定，Spring Boot BOM 不管理 AWS SDK）。
注意：AWS SDK v2 **没有**独立的 `s3-presigner` artifact，`S3Presigner` 就打包在 `s3` 内，只需这一个依赖：

```xml
        <!-- IM 富媒体：S3 兼容对象存储（MinIO/阿里云 OSS）预签名直传 -->
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>s3</artifactId>
            <version>2.29.52</version>
        </dependency>
```

- [ ] **Step 4: 建 `MediaProperties`**

创建 `MediaProperties.java`：

```java
package com.rbac.im.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 富媒体对象存储配置（S3 兼容：MinIO/OSS）。 */
@Component
@ConfigurationProperties(prefix = "rbac.im.media")
@Data
public class MediaProperties {

    private String endpoint;
    private String accessKey;
    private String secretKey;
    private String bucket;
    private String region = "us-east-1";
    private long putTtlSeconds = 300;
    private long getTtlSeconds = 300;
    /** key = 小写类型（image/audio/file）。 */
    private Map<String, Limit> limits = new HashMap<>();

    /** 按消息类型取上限规则；未知类型返回 null。 */
    public Limit limitFor(String type) {
        return type == null ? null : limits.get(type.toLowerCase());
    }

    @Data
    public static class Limit {
        private long maxSize;
        private List<String> mimes = new ArrayList<>();
    }
}
```

- [ ] **Step 5: 加 yml 配置**

在 `backend/src/main/resources/application.yml` 的 `rbac.im` 节点下（`group-max-members: 500` 之后）追加 `media`：

```yaml
    media:
      endpoint: http://localhost:9000
      access-key: rbac
      secret-key: rbac123456
      bucket: im-media
      region: us-east-1
      put-ttl-seconds: 300
      get-ttl-seconds: 300
      limits:
        image:
          max-size: 10485760
          mimes: [image/jpeg, image/png, image/gif, image/webp]
        audio:
          max-size: 20971520
          mimes: [audio/mpeg, audio/mp4, audio/aac, audio/ogg, audio/wav]
        file:
          max-size: 104857600
          mimes: ["*"]
```

> `application.yml` 是默认 profile，`@ActiveProfiles("test")` 时也会加载（test profile 只覆盖 datasource/redis），故 media 配置一处即可，测试可见。

- [ ] **Step 6: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=MediaPropertiesTest`
Expected: PASS（首次会下载 AWS SDK 依赖）。

- [ ] **Step 7: 提交**

```bash
git add backend/pom.xml \
        backend/src/main/java/com/rbac/im/config/MediaProperties.java \
        backend/src/main/resources/application.yml \
        backend/src/test/java/com/rbac/im/config/MediaPropertiesTest.java
git commit -m "feat(im): 加 AWS SDK v2 依赖与 rbac.im.media 配置绑定"
```

---

### Task 2: `MediaStorage` 端口 + `S3MediaStorage`（真实 MinIO 集成测）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/MediaStorage.java`
- Create: `backend/src/main/java/com/rbac/im/service/S3MediaStorage.java`
- Test: `backend/src/test/java/com/rbac/im/service/S3MediaStorageIT.java`

**Interfaces:**
- Consumes: `MediaProperties`。
- Produces:
  - `MediaStorage.ensureBucket()`（桶不存在则建）。
  - `MediaStorage.presignPut(String objectKey, java.time.Duration ttl) -> String`（预签名 PUT URL）。
  - `MediaStorage.presignGet(String objectKey, java.time.Duration ttl) -> String`（预签名 GET URL）。
  - `MediaStorage.stat(String objectKey) -> Optional<MediaStorage.ObjectStat>`（HEAD；不存在返回 empty）。
  - `record MediaStorage.ObjectStat(long size, String contentType)`。

- [ ] **Step 1: 写失败测试**

创建 `S3MediaStorageIT.java`（真实连本地 MinIO；MinIO 已随 compose profile `im` 起在 :9000）：

```java
package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 真实 MinIO 全链路：建桶 → 预签名 PUT 上传 → HEAD → 预签名 GET 取回一致。 */
@SpringBootTest
@ActiveProfiles("test")
class S3MediaStorageIT {

    @Autowired MediaStorage storage;

    @Test
    void presignPut_head_presignGet_roundTrip() throws Exception {
        storage.ensureBucket();
        String key = "im/c_it_1/199001/" + UUID.randomUUID().toString().replace("-", "") + ".txt";
        byte[] data = "hello-media".getBytes(StandardCharsets.UTF_8);
        HttpClient http = HttpClient.newHttpClient();

        String putUrl = storage.presignPut(key, Duration.ofMinutes(5));
        HttpResponse<Void> put = http.send(
                HttpRequest.newBuilder(URI.create(putUrl))
                        .PUT(HttpRequest.BodyPublishers.ofByteArray(data)).build(),
                HttpResponse.BodyHandlers.discarding());
        assertThat(put.statusCode()).isBetween(200, 299);

        Optional<MediaStorage.ObjectStat> stat = storage.stat(key);
        assertThat(stat).isPresent();
        assertThat(stat.get().size()).isEqualTo(data.length);

        assertThat(storage.stat("im/c_it_1/199001/does-not-exist.txt")).isEmpty();

        String getUrl = storage.presignGet(key, Duration.ofMinutes(5));
        HttpResponse<byte[]> get = http.send(
                HttpRequest.newBuilder(URI.create(getUrl)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertThat(get.body()).isEqualTo(data);
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=S3MediaStorageIT`
Expected: 编译失败——`MediaStorage` 不存在。

- [ ] **Step 3: 建 `MediaStorage` 接口**

创建 `MediaStorage.java`：

```java
package com.rbac.im.service;

import java.time.Duration;
import java.util.Optional;

/** 对象存储端口（S3 兼容）。唯一接触 S3 SDK 的抽象，便于逻辑层单测 mock。 */
public interface MediaStorage {

    /** 桶不存在则创建（幂等）。 */
    void ensureBucket();

    /** 生成预签名 PUT URL（客户端直传用）。 */
    String presignPut(String objectKey, Duration ttl);

    /** 生成预签名 GET URL（客户端回显用，短 TTL）。 */
    String presignGet(String objectKey, Duration ttl);

    /** HEAD 对象；不存在返回 empty。 */
    Optional<ObjectStat> stat(String objectKey);

    /** 对象元数据（服务端权威）。 */
    record ObjectStat(long size, String contentType) {}
}
```

- [ ] **Step 4: 建 `S3MediaStorage` 实现**

创建 `S3MediaStorage.java`：

```java
package com.rbac.im.service;

import com.rbac.im.config.MediaProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.net.URI;
import java.time.Duration;
import java.util.Optional;

/** {@link MediaStorage} 的 AWS SDK v2 实现；endpoint override 使其对 MinIO/阿里云 OSS 通用。 */
@Component
public class S3MediaStorage implements MediaStorage {

    private static final Logger log = LoggerFactory.getLogger(S3MediaStorage.class);

    private final MediaProperties props;
    private final S3Client s3;
    private final S3Presigner presigner;

    public S3MediaStorage(MediaProperties props) {
        this.props = props;
        StaticCredentialsProvider creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(props.getAccessKey(), props.getSecretKey()));
        Region region = Region.of(props.getRegion());
        URI endpoint = URI.create(props.getEndpoint());
        this.s3 = S3Client.builder()
                .endpointOverride(endpoint)
                .credentialsProvider(creds)
                .region(region)
                .forcePathStyle(true)   // MinIO 需 path-style 寻址
                .build();
        this.presigner = S3Presigner.builder()
                .endpointOverride(endpoint)
                .credentialsProvider(creds)
                .region(region)
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .build();
    }

    /** 启动时尝试建桶；失败只告警不阻断启动（MinIO 恢复前媒体不可用）。 */
    @PostConstruct
    void init() {
        try {
            ensureBucket();
        } catch (Exception e) {
            log.warn("MinIO ensureBucket 失败，媒体上传在 MinIO 恢复前不可用: {}", e.toString());
        }
    }

    @Override
    public void ensureBucket() {
        try {
            s3.headBucket(b -> b.bucket(props.getBucket()));
        } catch (NoSuchBucketException e) {
            s3.createBucket(b -> b.bucket(props.getBucket()));
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                s3.createBucket(b -> b.bucket(props.getBucket()));
            } else {
                throw e;
            }
        }
    }

    @Override
    public String presignPut(String objectKey, Duration ttl) {
        PutObjectRequest put = PutObjectRequest.builder()
                .bucket(props.getBucket()).key(objectKey).build();
        return presigner.presignPutObject(b -> b.signatureDuration(ttl).putObjectRequest(put))
                .url().toString();
    }

    @Override
    public String presignGet(String objectKey, Duration ttl) {
        GetObjectRequest get = GetObjectRequest.builder()
                .bucket(props.getBucket()).key(objectKey).build();
        return presigner.presignGetObject(b -> b.signatureDuration(ttl).getObjectRequest(get))
                .url().toString();
    }

    @Override
    public Optional<ObjectStat> stat(String objectKey) {
        try {
            HeadObjectResponse head = s3.headObject(b -> b.bucket(props.getBucket()).key(objectKey));
            return Optional.of(new ObjectStat(head.contentLength(), head.contentType()));
        } catch (NoSuchKeyException e) {
            return Optional.empty();
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                return Optional.empty();
            }
            throw e;
        }
    }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=S3MediaStorageIT`
Expected: PASS（连本地 MinIO :9000）。若连接失败，先确认 `cd deploy && docker compose --profile im up -d minio`。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/MediaStorage.java \
        backend/src/main/java/com/rbac/im/service/S3MediaStorage.java \
        backend/src/test/java/com/rbac/im/service/S3MediaStorageIT.java
git commit -m "feat(im): MediaStorage 端口 + S3MediaStorage(AWS SDK v2) 预签名/HEAD/建桶"
```

---

### Task 3: `MediaUrlEnricher`（媒体 body 附加临时 GET url）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/MediaUrlEnricher.java`
- Test: `backend/src/test/java/com/rbac/im/service/MediaUrlEnricherTest.java`

**Interfaces:**
- Consumes: `MediaStorage.presignGet`；`MediaProperties.getGetTtlSeconds`。
- Produces: `MediaUrlEnricher.enrich(String type, Map<String,Object> body) -> Map<String,Object>`（媒体类型且 body 含 objectKey → 返回带 `url` 的新副本；否则原样返回，持久化 body 不受影响）。

- [ ] **Step 1: 写失败测试**

创建 `MediaUrlEnricherTest.java`（`@MockBean MediaStorage` 隔离真实 S3）：

```java
package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@SpringBootTest
@ActiveProfiles("test")
class MediaUrlEnricherTest {

    @Autowired MediaUrlEnricher enricher;
    @MockBean MediaStorage storage;

    @Test
    void image_getsUrl_fromPresignedGet() {
        when(storage.presignGet(eq("im/c_1_2/199001/abc.png"), any(Duration.class)))
                .thenReturn("http://signed/get");
        Map<String, Object> body = new HashMap<>();
        body.put("objectKey", "im/c_1_2/199001/abc.png");
        body.put("width", 100);

        Map<String, Object> out = enricher.enrich("IMAGE", body);

        assertThat(out.get("url")).isEqualTo("http://signed/get");
        assertThat(out.get("width")).isEqualTo(100);
        assertThat(body).doesNotContainKey("url");   // 原 body 不被污染
    }

    @Test
    void text_isNoOp() {
        Map<String, Object> body = Map.of("text", "hi");
        assertThat(enricher.enrich("TEXT", body)).isSameAs(body);
    }

    @Test
    void media_withoutObjectKey_isNoOp() {
        Map<String, Object> body = Map.of("foo", "bar");
        assertThat(enricher.enrich("FILE", body)).isSameAs(body);
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=MediaUrlEnricherTest`
Expected: 编译失败——`MediaUrlEnricher` 不存在。

- [ ] **Step 3: 实现 `MediaUrlEnricher`**

创建 `MediaUrlEnricher.java`：

```java
package com.rbac.im.service;

import com.rbac.im.config.MediaProperties;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** 给富媒体消息 body 附加临时预签名 GET url。push 与 pull 两条读路径共用，保证在线/离线回显一致。 */
@Service
public class MediaUrlEnricher {

    static final Set<String> MEDIA_TYPES = Set.of("IMAGE", "AUDIO", "FILE");

    private final MediaStorage storage;
    private final MediaProperties props;

    public MediaUrlEnricher(MediaStorage storage, MediaProperties props) {
        this.storage = storage;
        this.props = props;
    }

    /** 媒体类型且含 objectKey → 返回带 url 的新副本；否则原样返回（不改动持久化 body）。 */
    public Map<String, Object> enrich(String type, Map<String, Object> body) {
        if (!MEDIA_TYPES.contains(type) || body == null || !(body.get("objectKey") instanceof String objectKey)) {
            return body;
        }
        Map<String, Object> copy = new HashMap<>(body);
        copy.put("url", storage.presignGet(objectKey, Duration.ofSeconds(props.getGetTtlSeconds())));
        return copy;
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=MediaUrlEnricherTest`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/MediaUrlEnricher.java \
        backend/src/test/java/com/rbac/im/service/MediaUrlEnricherTest.java
git commit -m "feat(im): MediaUrlEnricher——媒体 body 附加临时预签名 GET url"
```

---

### Task 4: 上传预签名闭环（`MediaService.presign` + `POST /api/im/upload/presign`）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/MediaService.java`
- Create: `backend/src/main/java/com/rbac/im/dto/PresignRequest.java`
- Create: `backend/src/main/java/com/rbac/im/vo/PresignResult.java`
- Create: `backend/src/main/java/com/rbac/im/controller/ImUploadController.java`
- Modify: `backend/src/main/resources/i18n/messages.properties`、`messages_en_US.properties`、`messages_zh_CN.properties`
- Test: `backend/src/test/java/com/rbac/im/controller/ImUploadControllerMockMvcTest.java`

**Interfaces:**
- Consumes: `ConversationService.isMember`；`MediaProperties.limitFor`；`MediaStorage.presignPut`。
- Produces:
  - `MediaService.presign(long userId, String cid, String type, String filename, String mime, long size) -> PresignResult`。
  - `static boolean MediaService.isMedia(String type)`。
  - `PresignRequest{ String cid; String type; String filename; String mime; long size; }`。
  - `PresignResult{ String objectKey; String uploadUrl; long expiresIn; }`。

- [ ] **Step 1: 写失败测试**

创建 `ImUploadControllerMockMvcTest.java`：

```java
package com.rbac.im.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.service.MediaStorage;
import com.rbac.security.model.LoginUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ImUploadControllerMockMvcTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired ImConversationMemberMapper memberMapper;
    @MockBean MediaStorage storage;   // 隔离真实 MinIO

    final String cid = "c_7001_7002";

    private Authentication authAs(long userId) {
        LoginUser u = new LoginUser();
        u.setUserId(userId);
        u.setUsername("u" + userId);
        return new UsernamePasswordAuthenticationToken(u, null, List.of());
    }

    @BeforeEach
    void setup() {
        when(storage.presignPut(any(), any(Duration.class))).thenReturn("http://signed/put");
        conversationMapper.delete(new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        memberMapper.delete(new LambdaQueryWrapper<ImConversationMember>().eq(ImConversationMember::getCid, cid));
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType("SINGLE"); c.setLastMsgSeq(0L);
        conversationMapper.insert(c);
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid); m.setUserId(7001L); m.setLastReadSeq(0L); m.setMentionSeq(0L); m.setMuted(0);
        memberMapper.insert(m);
    }

    private String body(String type, String mime, long size) throws Exception {
        return om.writeValueAsString(Map.of(
                "cid", cid, "type", type, "filename", "p.png", "mime", mime, "size", size));
    }

    @Test
    void member_getsPresignedUrl() throws Exception {
        mvc.perform(post("/im/upload/presign").with(authentication(authAs(7001L)))
                        .contentType("application/json").content(body("IMAGE", "image/png", 1024)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.uploadUrl").value("http://signed/put"))
                .andExpect(jsonPath("$.data.objectKey").value(org.hamcrest.Matchers.startsWith("im/" + cid + "/")));
    }

    @Test
    void nonMember_rejected() throws Exception {
        mvc.perform(post("/im/upload/presign").with(authentication(authAs(9999L)))
                        .contentType("application/json").content(body("IMAGE", "image/png", 1024)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(403));
    }

    @Test
    void mimeNotAllowed_rejected() throws Exception {
        mvc.perform(post("/im/upload/presign").with(authentication(authAs(7001L)))
                        .contentType("application/json").content(body("IMAGE", "application/x-msdownload", 1024)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void tooLarge_rejected() throws Exception {
        mvc.perform(post("/im/upload/presign").with(authentication(authAs(7001L)))
                        .contentType("application/json").content(body("IMAGE", "image/png", 99999999L)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=ImUploadControllerMockMvcTest`
Expected: 编译失败——`MediaService`/`ImUploadController` 不存在。

- [ ] **Step 3: 建 DTO/VO**

`dto/PresignRequest.java`：

```java
package com.rbac.im.dto;

import lombok.Data;

@Data
public class PresignRequest {
    private String cid;
    private String type;
    private String filename;
    private String mime;
    private long size;
}
```

`vo/PresignResult.java`：

```java
package com.rbac.im.vo;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class PresignResult {
    private String objectKey;
    private String uploadUrl;
    private long expiresIn;
}
```

- [ ] **Step 4: 建 `MediaService`（本任务只实现 presign + isMedia）**

创建 `MediaService.java`：

```java
package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.config.MediaProperties;
import com.rbac.im.vo.PresignResult;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** 富媒体：上传预签名 + 发送校验。对象存储访问全部经 {@link MediaStorage} 端口。 */
@Service
public class MediaService {

    private static final Set<String> MEDIA_TYPES = Set.of("IMAGE", "AUDIO", "FILE");
    private static final DateTimeFormatter YM = DateTimeFormatter.ofPattern("yyyyMM");

    private final MediaProperties props;
    private final MediaStorage storage;
    private final ConversationService conversationService;

    public MediaService(MediaProperties props, MediaStorage storage, ConversationService conversationService) {
        this.props = props;
        this.storage = storage;
        this.conversationService = conversationService;
    }

    public static boolean isMedia(String type) {
        return MEDIA_TYPES.contains(type);
    }

    /** 上传预签名：成员 + 白名单 + 大小校验，生成 objectKey 与预签名 PUT URL。 */
    public PresignResult presign(long userId, String cid, String type, String filename, String mime, long size) {
        if (!conversationService.isMember(cid, userId)) {
            throw new BusinessException(403, "im.conversation.notMember");
        }
        MediaProperties.Limit limit = props.limitFor(type);
        if (limit == null) {
            throw new BusinessException(400, "im.media.typeUnsupported");
        }
        if (!mimeAllowed(limit.getMimes(), mime)) {
            throw new BusinessException(400, "im.media.mimeNotAllowed");
        }
        if (size <= 0 || size > limit.getMaxSize()) {
            throw new BusinessException(400, "im.media.tooLarge");
        }
        String objectKey = buildKey(cid, filename);
        String uploadUrl = storage.presignPut(objectKey, Duration.ofSeconds(props.getPutTtlSeconds()));
        return new PresignResult(objectKey, uploadUrl, props.getPutTtlSeconds());
    }

    private boolean mimeAllowed(List<String> mimes, String mime) {
        return mimes.contains("*") || (mime != null && mimes.contains(mime));
    }

    private String buildKey(String cid, String filename) {
        String ext = "";
        if (filename != null) {
            int dot = filename.lastIndexOf('.');
            if (dot >= 0 && dot < filename.length() - 1) {
                ext = filename.substring(dot).toLowerCase();
            }
        }
        String ym = LocalDate.now().format(YM);
        String uuid = UUID.randomUUID().toString().replace("-", "");
        return "im/" + cid + "/" + ym + "/" + uuid + ext;
    }
}
```

- [ ] **Step 5: 建 `ImUploadController`**

创建 `ImUploadController.java`：

```java
package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.dto.PresignRequest;
import com.rbac.im.service.MediaService;
import com.rbac.im.vo.PresignResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** IM 富媒体上传：预签名直传。 */
@RestController
@RequestMapping("/im/upload")
public class ImUploadController {

    private final MediaService mediaService;

    public ImUploadController(MediaService mediaService) {
        this.mediaService = mediaService;
    }

    @PostMapping("/presign")
    public Result<PresignResult> presign(@RequestBody PresignRequest req) {
        return Result.success(mediaService.presign(
                SecurityUtils.getUserId(), req.getCid(), req.getType(),
                req.getFilename(), req.getMime(), req.getSize()));
    }
}
```

- [ ] **Step 6: 加 i18n 文案**

在三份文件末尾各加（`messages.properties` 与 `messages_en_US.properties` 用英文，`messages_zh_CN.properties` 用中文）：

`messages.properties` 与 `messages_en_US.properties`：

```properties
im.media.typeUnsupported=Unsupported media type
im.media.mimeNotAllowed=File type not allowed
im.media.tooLarge=File exceeds size limit
```

`messages_zh_CN.properties`：

```properties
im.media.typeUnsupported=不支持的媒体类型
im.media.mimeNotAllowed=不允许的文件类型
im.media.tooLarge=文件超过大小上限
```

- [ ] **Step 7: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=ImUploadControllerMockMvcTest`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/MediaService.java \
        backend/src/main/java/com/rbac/im/dto/PresignRequest.java \
        backend/src/main/java/com/rbac/im/vo/PresignResult.java \
        backend/src/main/java/com/rbac/im/controller/ImUploadController.java \
        backend/src/main/resources/i18n/ \
        backend/src/test/java/com/rbac/im/controller/ImUploadControllerMockMvcTest.java
git commit -m "feat(im): 上传预签名闭环（MediaService.presign + POST /im/upload/presign）"
```

---

### Task 5: 发送校验 + HEAD 回填（`validateForSend` + 接入 `InboundMessageConsumer`）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/MediaService.java`（加 `validateForSend`）
- Create: `backend/src/main/java/com/rbac/im/service/MediaValidationException.java`
- Modify: `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`（加媒体校验分支）
- Modify: `backend/src/test/java/com/rbac/im/service/InboundMessageConsumerTest.java`（构造补 `MediaService` 参数）
- Test: `backend/src/test/java/com/rbac/im/service/MediaSendCheckTest.java`

**Interfaces:**
- Consumes: `MediaStorage.stat`。
- Produces:
  - `MediaService.validateForSend(String cid, Map<String,Object> body)`（校验 objectKey 前缀 `im/{cid}/` + HEAD 存在；成功则回填 body 的 `size`/`mime`；失败抛 `MediaValidationException`）。
  - `MediaValidationException extends RuntimeException`，`getReason() -> String`（`INVALID_OBJECT` / `OBJECT_NOT_FOUND`）。

- [ ] **Step 1: 写失败测试**

创建 `MediaSendCheckTest.java`（`@MockBean MediaStorage` + `@MockBean OutboundDispatcher` 拦截扇出/ERROR）：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("test")
class MediaSendCheckTest {

    @Autowired InboundMessageConsumer consumer;
    @Autowired ImMessageRepository repo;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired ImConversationMemberMapper memberMapper;
    @MockBean MediaStorage storage;
    @MockBean OutboundDispatcher dispatcher;

    final ObjectMapper om = new ObjectMapper();
    final String cid = "c_7201_7202";

    @BeforeEach
    void setup() {
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(1000)));
        conversationMapper.delete(new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        memberMapper.delete(new LambdaQueryWrapper<ImConversationMember>().eq(ImConversationMember::getCid, cid));
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType("SINGLE"); c.setLastMsgSeq(0L);
        conversationMapper.insert(c);
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid); m.setUserId(7201L); m.setLastReadSeq(0L); m.setMentionSeq(0L); m.setMuted(0);
        memberMapper.insert(m);
    }

    private String imageJson(String objectKey) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND"); e.setCid(cid); e.setSenderId(7201L);
        e.setType("IMAGE");
        Map<String, Object> body = new HashMap<>();
        body.put("objectKey", objectKey);
        body.put("size", 1);        // 客户端自报，应被 HEAD 覆盖
        e.setBody(body);
        e.setClientMsgId("cm-" + objectKey.hashCode());
        return om.writeValueAsString(e);
    }

    @Test
    void wrongPrefix_dropped_andError() throws Exception {
        consumer.onMessage(imageJson("im/c_OTHER/199001/x.png"));   // 前缀不属本会话
        assertThat(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10))).isEmpty();
        verify(dispatcher).dispatchToUser(eq(7201L), argThat(env ->
                "ERROR".equals(env.getOp()) && "INVALID_OBJECT".equals(env.getBody().get("reason"))));
    }

    @Test
    void objectMissing_dropped_andError() throws Exception {
        when(storage.stat(anyString())).thenReturn(Optional.empty());
        consumer.onMessage(imageJson("im/" + cid + "/199001/x.png"));
        assertThat(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10))).isEmpty();
        verify(dispatcher).dispatchToUser(eq(7201L), argThat(env ->
                "OBJECT_NOT_FOUND".equals(env.getBody().get("reason"))));
    }

    @Test
    void valid_persisted_withBackfilledSizeMime() throws Exception {
        when(storage.stat(anyString()))
                .thenReturn(Optional.of(new MediaStorage.ObjectStat(20480L, "image/png")));
        consumer.onMessage(imageJson("im/" + cid + "/199001/x.png"));

        List<ImMessage> rows = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10));
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getBody().get("size")).isEqualTo(20480);   // HEAD 值覆盖客户端自报的 1
        assertThat(rows.get(0).getBody().get("mime")).isEqualTo("image/png");
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=MediaSendCheckTest`
Expected: 编译失败——`MediaValidationException` / `validateForSend` 不存在。

- [ ] **Step 3: 建 `MediaValidationException`**

创建 `MediaValidationException.java`：

```java
package com.rbac.im.service;

/** 富媒体发送校验失败，携带回给客户端的 reason（INVALID_OBJECT / OBJECT_NOT_FOUND）。 */
public class MediaValidationException extends RuntimeException {

    private final String reason;

    public MediaValidationException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
```

- [ ] **Step 4: `MediaService` 加 `validateForSend`**

在 `MediaService.java` 追加方法：

```java
    /** 发送媒体消息前校验：objectKey 须属本会话且对象真实存在；成功则用 HEAD 回填权威 size/mime。 */
    public void validateForSend(String cid, Map<String, Object> body) {
        if (body == null || !(body.get("objectKey") instanceof String objectKey)
                || !objectKey.startsWith("im/" + cid + "/")) {
            throw new MediaValidationException("INVALID_OBJECT");
        }
        MediaStorage.ObjectStat stat = storage.stat(objectKey)
                .orElseThrow(() -> new MediaValidationException("OBJECT_NOT_FOUND"));
        body.put("size", stat.size());
        body.put("mime", stat.contentType());
    }
```

（同文件补 import：`import java.util.Map;`）

- [ ] **Step 5: `InboundMessageConsumer` 接入媒体校验**

改 `InboundMessageConsumer.java`：构造注入 `MediaService`，在群禁言校验之后、`appender.append` 之前加媒体分支。完整替换为：

```java
package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class InboundMessageConsumer {

    private final ImMessageRepository repo;
    private final MessageAppender appender;
    private final ConversationService conversationService;
    private final OutboundDispatcher dispatcher;
    private final MediaService mediaService;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundMessageConsumer(ImMessageRepository repo,
                                  MessageAppender appender,
                                  ConversationService conversationService,
                                  OutboundDispatcher dispatcher,
                                  MediaService mediaService) {
        this.repo = repo;
        this.appender = appender;
        this.conversationService = conversationService;
        this.dispatcher = dispatcher;
        this.mediaService = mediaService;
    }

    @KafkaListener(topics = ImKafkaTopics.IN, groupId = "im-logic")
    public void onMessage(String json) throws Exception {
        Envelope env = mapper.readValue(json, Envelope.class);

        // 幂等：同一发送者 + clientMsgId 只处理一次
        if (env.getClientMsgId() != null
                && repo.existsBySenderIdAndClientMsgId(env.getSenderId(), env.getClientMsgId())) {
            return;
        }

        // 成员校验（安全红线）：非成员 / 被禁言 → 丢弃并回 ERROR
        if (!conversationService.isMember(env.getCid(), env.getSenderId())) {
            pushError(env, "NOT_MEMBER");
            return;
        }
        if (conversationService.isGroupMuted(env.getCid(), env.getSenderId())) {
            pushError(env, "MUTED");
            return;
        }

        // 富媒体校验：objectKey 归属 + HEAD 确认 + 回填 size/mime
        if (MediaService.isMedia(env.getType())) {
            try {
                mediaService.validateForSend(env.getCid(), env.getBody());
            } catch (MediaValidationException ex) {
                pushError(env, ex.getReason());
                return;
            }
        }

        appender.append(env.getCid(), env.getSenderId(), env.getType(), env.getBody(), env.getClientMsgId());
    }

    private void pushError(Envelope src, String reason) {
        Envelope err = new Envelope();
        err.setOp("ERROR");
        err.setCid(src.getCid());
        err.setSenderId(src.getSenderId());
        err.setClientMsgId(src.getClientMsgId());
        err.setBody(Map.of("reason", reason));
        dispatcher.dispatchToUser(src.getSenderId(), err);
    }
}
```

- [ ] **Step 6: 修 `InboundMessageConsumerTest` 构造签名**

`InboundMessageConsumerTest.java` 手动 `new InboundMessageConsumer(...)` 处（两处）补第 5 个参数——TEXT 路径不触达媒体逻辑，传 Mockito mock 即可。先在类内确保有 `import static org.mockito.Mockito.mock;`，然后把两处：

```java
InboundMessageConsumer c = new InboundMessageConsumer(repo, appender, conversationService, dispatcher);
```

改为：

```java
InboundMessageConsumer c = new InboundMessageConsumer(repo, appender, conversationService, dispatcher, mock(MediaService.class));
```

- [ ] **Step 7: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=MediaSendCheckTest,InboundMessageConsumerTest,InboundSendCheckTest`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/MediaService.java \
        backend/src/main/java/com/rbac/im/service/MediaValidationException.java \
        backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java \
        backend/src/test/java/com/rbac/im/service/InboundMessageConsumerTest.java \
        backend/src/test/java/com/rbac/im/service/MediaSendCheckTest.java
git commit -m "feat(im): 媒体发送校验（objectKey 归属+HEAD 回填 size/mime），被拒回 ERROR"
```

---

### Task 6: 读路径接入 enricher（push + pull 都回显临时 GET url）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/MessageAppender.java`（扇出前 enrich push body）
- Modify: `backend/src/main/java/com/rbac/im/service/MessageQueryService.java`（`toVo` enrich）
- Test: `backend/src/test/java/com/rbac/im/service/MediaReadEnrichTest.java`

**Interfaces:**
- Consumes: `MediaUrlEnricher.enrich`。
- Produces（行为）：pull 返回的媒体消息 `body` 含 `url`；在线 push 的 Envelope `body` 含 `url`；持久化 body 仍不含 `url`。

- [ ] **Step 1: 写失败测试**

创建 `MediaReadEnrichTest.java`：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.ImMessageVO;
import com.rbac.im.vo.PullResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("test")
class MediaReadEnrichTest {

    @Autowired MessageQueryService queryService;
    @Autowired MessageAppender appender;
    @Autowired ImMessageRepository repo;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired ImConversationMemberMapper memberMapper;
    @MockBean MediaStorage storage;
    @MockBean OutboundDispatcher dispatcher;   // 捕获 push Envelope

    final String cid = "c_7301_7302";

    @BeforeEach
    void setup() {
        when(storage.presignGet(anyString(), any(Duration.class))).thenReturn("http://signed/get");
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(1000)));
        conversationMapper.delete(new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        memberMapper.delete(new LambdaQueryWrapper<ImConversationMember>().eq(ImConversationMember::getCid, cid));
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType("SINGLE"); c.setLastMsgSeq(0L);
        conversationMapper.insert(c);
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid); m.setUserId(7301L); m.setLastReadSeq(0L); m.setMentionSeq(0L); m.setMuted(0);
        memberMapper.insert(m);
    }

    @Test
    void pull_image_getsUrl_text_doesNot() {
        Map<String, Object> imgBody = new HashMap<>();
        imgBody.put("objectKey", "im/" + cid + "/199001/a.png");
        appender.append(cid, 7301L, "IMAGE", imgBody, "cm-img");
        appender.append(cid, 7301L, "TEXT", new HashMap<>(Map.of("text", "hi")), "cm-txt");

        PullResult r = queryService.pull(cid, 0L, 10, 7301L);
        ImMessageVO img = r.getMessages().stream().filter(v -> "IMAGE".equals(v.getType())).findFirst().orElseThrow();
        ImMessageVO txt = r.getMessages().stream().filter(v -> "TEXT".equals(v.getType())).findFirst().orElseThrow();

        assertThat(img.getBody().get("url")).isEqualTo("http://signed/get");
        assertThat(txt.getBody()).doesNotContainKey("url");

        // 持久化 body 不含 url
        ImMessage stored = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10)).stream()
                .filter(msg -> "IMAGE".equals(msg.getType())).findFirst().orElseThrow();
        assertThat(stored.getBody()).doesNotContainKey("url");
    }

    @Test
    void push_image_envelopeBody_hasUrl() {
        Map<String, Object> imgBody = new HashMap<>();
        imgBody.put("objectKey", "im/" + cid + "/199001/b.png");
        appender.append(cid, 7301L, "IMAGE", imgBody, "cm-push");

        verify(dispatcher).dispatch(eq(cid), argThat((Envelope env) ->
                "http://signed/get".equals(env.getBody().get("url"))));
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=MediaReadEnrichTest`
Expected: FAIL——push/pull 的 body 尚无 url。

- [ ] **Step 3: `MessageAppender` 扇出前 enrich**

在 `MessageAppender.java`：构造注入 `MediaUrlEnricher enricher`（加字段 + 构造参数 + 赋值），并把扇出前设置 push body 的那行

```java
        push.setBody(body);
```

改为

```java
        push.setBody(enricher.enrich(type, body));
```

（持久化的 `m.setBody(body)` 保持不变——只有 push 副本带 url。）

- [ ] **Step 4: `MessageQueryService.toVo` enrich**

在 `MessageQueryService.java`：构造注入 `MediaUrlEnricher enricher`（加字段 + 构造参数 + 赋值），把 `toVo` 里

```java
        vo.setBody(m.getBody());
```

改为

```java
        vo.setBody(enricher.enrich(m.getType(), m.getBody()));
```

- [ ] **Step 5: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=MediaReadEnrichTest,MessageAppenderTest,MessageQueryServiceTest`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/MessageAppender.java \
        backend/src/main/java/com/rbac/im/service/MessageQueryService.java \
        backend/src/test/java/com/rbac/im/service/MediaReadEnrichTest.java
git commit -m "feat(im): push/pull 读路径接入 MediaUrlEnricher 回显临时 GET url"
```

---

### Task 7: 全量回归 + 里程碑收尾

**Files:** 无新增（回归与文档）。

- [ ] **Step 1: 跑全部 IM 测试**

Run: `mvn -f backend/pom.xml test -Dtest='com.rbac.im.**'`
Expected: 全绿。若失败，按 `superpowers:systematic-debugging` 定位，勿盲改。

- [ ] **Step 2: 全量构建**

Run: `mvn -f backend/pom.xml package -DskipTests=false`
Expected: BUILD SUCCESS。

- [ ] **Step 3: 标记里程碑 6 完成**

在 `docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` 里程碑 6 旁注记「✅ 已完成（feat/im，Phase 4）」。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md
git commit -m "test(im): 富媒体里程碑6 全量回归通过；标记里程碑6完成"
```

---

## Self-Review（作者自查记录）

- **Spec 覆盖**：预签名上传 → Task 4；三类媒体发送校验+HEAD 回填 → Task 5；读回显（push+pull 共用 enricher）→ Task 3+6；端口抽象 MediaStorage/S3 实现+建桶 → Task 2；配置 rbac.im.media → Task 1；不做缩略图/链接卡片 → 计划中无对应任务（符合排除项）；无 SSRF 面（不抓用户 URL）→ 全程只签 MinIO 自有对象。
- **类型一致性**：`MediaStorage.presignPut/presignGet(String,Duration)->String`、`stat(String)->Optional<ObjectStat>`、`ObjectStat(long size,String contentType)`；`MediaUrlEnricher.enrich(String,Map)->Map`；`MediaService.presign(long,String,String,String,String,long)->PresignResult`、`static isMedia(String)`、`validateForSend(String,Map)`；`MediaValidationException.getReason()->String`——跨 Task 一致。
- **构造签名变更影响**：`InboundMessageConsumer` +MediaService（Task 5 Step 6 同步修 `InboundMessageConsumerTest` 手动构造；`InboundSendCheckTest`/`MediaSendCheckTest` 用 `@Autowired` 由 DI 注入）；`MessageAppender` +MediaUrlEnricher、`MessageQueryService` +MediaUrlEnricher（其测试均 `@Autowired`，DI 处理）。
- **持久化不含 url**：Task 6 只 enrich push 副本与 pull VO，`m.setBody(body)` 与 `repo.save` 不变；Task 6 测试显式断言持久化 body `doesNotContainKey("url")`。
- **占位符**：无 TODO/TBD，每步给出完整代码与命令。
- **网关**：全程未改 im-gateway，符合范围约束。
