# Android FCM 消息推送实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 Android IM 客户端和 Spring Boot 服务端接入 FCM 消息通知，同时保持 WebSocket、REST 增量同步和 SQLite 为权威消息链。

**Architecture:** 消息落库后继续走现有 WebSocket 链，并异步发布 `PushCandidate` 到 Kafka 的 `im-push` 主题。独立消费者筛选发送者、免打扰和提及规则，再调用 Firebase Admin SDK；Android 原生服务负责账号校验、`msgId` 去重、前台抑制、后台通知和点击事件，React Native 只处理设备登记、权限时机和权威同步导航。

**Tech Stack:** Java 21、Spring Boot 3.4.1、Spring Kafka、MyBatis-Plus、Flyway、Micrometer、Firebase Admin Java 9.10.0、React Native 0.86、TypeScript 5.8、Kotlin 2.1、Firebase Android BoM 34.16.0、Google Services Gradle Plugin 4.5.0、Jest 29、JUnit 5/JUnit 4。

## Global Constraints

- 第一版只支持带 Google Play 服务的 Android 设备，不接入 APNs 或国内厂商通道
- Android 保持 `minSdkVersion = 24`、`targetSdkVersion = 36`、`compileSdkVersion = 36`
- FCM 只提醒，不直接写入 SQLite；WebSocket 和 REST 增量同步继续提供权威消息
- 前台不显示系统通知；后台或普通进程终止后显示通知
- 普通免打扰消息不通知，经过服务端校验的 `@我` 和 `@所有人` 仍通知
- 排除发送者用户 ID，从而排除发送者的所有设备
- 第一版只通知 `TEXT`、`IMAGE`、`AUDIO`、`FILE`；不通知 `READ`、`RECALL`、链接卡片更新、错误帧和系统控制消息
- Firebase Admin 凭证只能使用 Application Default Credentials、工作负载身份或 Secret 挂载，禁止进入仓库、APK、配置文件和日志
- 开发环境没有 Firebase 配置时保持可启动，服务端 `rbac.im.push.enabled` 默认 `false`
- 所有新增逻辑先写失败测试，再写最小实现；每个任务结束后独立提交
- 保留工作区中与本计划无关的用户修改，不重置、不覆盖、不顺手重构
- 依赖版本依据 2026-07-30 的 [Firebase Admin Java 发布记录](https://firebase.google.com/support/release-notes/admin/java) 和 [Firebase Android 接入文档](https://firebase.google.com/docs/android/setup)

---

## 文件结构

后端文件按职责拆分：

- `backend/src/main/java/com/rbac/im/push/registration/`：设备登记实体、Mapper、服务和控制器
- `backend/src/main/java/com/rbac/im/push/candidate/`：安全摘要、候选事件和 Kafka 发布
- `backend/src/main/java/com/rbac/im/push/delivery/`：接收人筛选、Payload、Firebase 网关、重试和指标
- `backend/src/main/resources/db/migration/V7__im_push_registration.sql`：登记表结构

Android 原生文件按生命周期拆分：

- `android/app/src/main/java/com/appmobile/push/model/`：不依赖 React 的 Payload 与通知模型
- `android/app/src/main/java/com/appmobile/push/store/`：账号、去重和待处理事件持久化
- `android/app/src/main/java/com/appmobile/push/notification/`：渠道、通知分组和点击 Intent
- `android/app/src/main/java/com/appmobile/push/bridge/`：React Native 原生模块和事件桥

React Native 应用文件按业务职责拆分：

- `src/push/nativePush.ts`：原生模块类型安全适配
- `src/push/pushRegistration.ts`：设备登记与解绑
- `src/push/pushPermission.ts`：权限提示时机
- `src/push/PushCoordinator.tsx`：前台同步提示和通知点击导航
- `src/navigation/navigationRef.ts`：容器外安全导航引用

### Task 1: 实现服务端设备登记模型和 API

**Files:**
- Create: `backend/src/main/resources/db/migration/V7__im_push_registration.sql`
- Create: `backend/src/main/java/com/rbac/im/push/registration/ImPushRegistration.java`
- Create: `backend/src/main/java/com/rbac/im/push/registration/ImPushRegistrationMapper.java`
- Create: `backend/src/main/java/com/rbac/im/push/registration/PushRegistrationRequest.java`
- Create: `backend/src/main/java/com/rbac/im/push/registration/PushRegistrationService.java`
- Create: `backend/src/main/java/com/rbac/im/push/registration/ImPushRegistrationController.java`
- Modify: `backend/src/main/java/com/rbac/common/web/GlobalExceptionHandler.java`
- Test: `backend/src/test/java/com/rbac/im/push/registration/PushRegistrationServiceTest.java`
- Test: `backend/src/test/java/com/rbac/im/push/registration/ImPushRegistrationControllerTest.java`

**Interfaces:**
- Consumes: `SecurityUtils.getUserId()`、MyBatis-Plus `BaseMapper`
- Produces: `PushRegistrationService.upsert(long userId, String deviceId, PushRegistrationRequest request)`、`disable(long userId, String deviceId)`、`disableTargetHash(String targetHash)`、`findFreshEnabledByUserIds(Collection<Long> userIds, LocalDateTime freshAfter)`

- [ ] **Step 1: 写登记服务失败测试**

```java
@Test
void upsert_rebindsExistingTargetToAuthenticatedAccount() {
    ImPushRegistration target = registration(10L, "old-device", "hash-a");
    when(mapper.selectByTargetHash("FCM", "hash-a")).thenReturn(target);
    when(mapper.selectByUserDevice(20L, "new-device", "FCM")).thenReturn(null);

    service.upsert(20L, "new-device", request("fid-a"));

    assertThat(target.getUserId()).isEqualTo(20L);
    assertThat(target.getDeviceId()).isEqualTo("new-device");
    assertThat(target.getEnabled()).isEqualTo(1);
    verify(mapper).updateById(target);
}

@Test
void disable_onlyTouchesAuthenticatedUsersDevice() {
    service.disable(20L, "device-a");
    verify(mapper).disableByUserDevice(20L, "device-a", "FCM");
}
```

- [ ] **Step 2: 运行测试并确认因类型不存在而失败**

Run: `mvn -pl backend -Dtest=PushRegistrationServiceTest test`

Expected: FAIL，编译器报告 `PushRegistrationService`、`ImPushRegistration` 不存在。

- [ ] **Step 3: 创建迁移、实体和 Mapper**

```sql
CREATE TABLE `im_push_registration` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `device_id` VARCHAR(64) NOT NULL,
    `platform` VARCHAR(16) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_value` TEXT NOT NULL,
    `target_hash` CHAR(64) NOT NULL,
    `app_version` VARCHAR(32) NULL,
    `enabled` TINYINT NOT NULL DEFAULT 1,
    `last_seen_at` DATETIME NOT NULL,
    `created_by` BIGINT NULL, `created_at` DATETIME NULL,
    `updated_by` BIGINT NULL, `updated_at` DATETIME NULL,
    `deleted` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_push_user_device_provider` (`user_id`, `device_id`, `provider`),
    UNIQUE KEY `uk_push_provider_target_hash` (`provider`, `target_hash`),
    KEY `idx_push_user_enabled_seen` (`user_id`, `enabled`, `last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 推送设备登记';
```

Mapper 必须提供以下精确方法，避免逻辑删除影响重绑：

```java
ImPushRegistration selectByTargetHash(String provider, String targetHash);
ImPushRegistration selectByUserDevice(long userId, String deviceId, String provider);
int disableByUserDevice(long userId, String deviceId, String provider);
int disableByTargetHash(String provider, String targetHash);
int physicalDeleteById(long id);
List<ImPushRegistration> selectFreshEnabled(Collection<Long> userIds, LocalDateTime freshAfter);
```

- [ ] **Step 4: 实现请求校验和事务化登记服务**

```java
public record PushRegistrationRequest(
        @NotBlank @Pattern(regexp = "ANDROID") String platform,
        @NotBlank @Pattern(regexp = "FCM") String provider,
        @NotBlank @Pattern(regexp = "FID|TOKEN") String targetType,
        @NotBlank @Size(max = 2048) String targetValue,
        @Size(max = 32) String appVersion) {}
```

`upsert` 使用 SHA-256 小写十六进制生成 `targetHash`。如果“当前用户与设备行”和“目标 Hash 行”不是同一行，先物理删除前者，再把目标行绑定到当前用户和设备。所有路径更新 `enabled=1` 与 `lastSeenAt=now`，禁止输出 `targetValue`。

```java
@Transactional
public void upsert(long userId, String deviceId, PushRegistrationRequest request) {
    String hash = sha256(request.targetValue());
    ImPushRegistration byDevice = mapper.selectByUserDevice(userId, deviceId, "FCM");
    ImPushRegistration byTarget = mapper.selectByTargetHash("FCM", hash);
    if (byDevice != null && byTarget != null && !byDevice.getId().equals(byTarget.getId())) {
        mapper.physicalDeleteById(byDevice.getId());
    }
    ImPushRegistration row = byTarget != null ? byTarget : byDevice;
    boolean insert = row == null;
    if (insert) row = new ImPushRegistration();
    row.setUserId(userId);
    row.setDeviceId(deviceId);
    row.setPlatform(request.platform());
    row.setProvider(request.provider());
    row.setTargetType(request.targetType());
    row.setTargetValue(request.targetValue());
    row.setTargetHash(hash);
    row.setAppVersion(request.appVersion());
    row.setEnabled(1);
    row.setLastSeenAt(LocalDateTime.now(clock));
    if (insert) mapper.insert(row); else mapper.updateById(row);
}
```

`sha256` 使用 `MessageDigest.getInstance("SHA-256")` 和 `HexFormat.of().formatHex(...)`，输入按 UTF-8 编码。

- [ ] **Step 5: 运行服务测试并确认通过**

Run: `mvn -pl backend -Dtest=PushRegistrationServiceTest test`

Expected: PASS。

- [ ] **Step 6: 写控制器失败测试**

```java
@Test
void put_derivesUserFromSecurityContext_andReturns204() throws Exception {
    mvc.perform(put("/im/push/registrations/device-a")
            .with(authentication(authAs(42L)))
            .contentType(APPLICATION_JSON)
            .content("""
                {"platform":"ANDROID","provider":"FCM","targetType":"FID",
                 "targetValue":"fid-a","appVersion":"1.0"}
                """))
        .andExpect(status().isNoContent());
    verify(service).upsert(eq(42L), eq("device-a"), any());
}

@Test
void put_rejectsOversizedDeviceId() throws Exception {
    mvc.perform(put("/im/push/registrations/" + "d".repeat(65))
            .with(authentication(authAs(42L)))
            .contentType(APPLICATION_JSON)
            .content(validBody()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(400));
}
```

- [ ] **Step 7: 实现控制器并运行控制器测试**

控制器使用 `@Validated`、`@Size(max = 64) @PathVariable String deviceId`、`@Valid @RequestBody`，PUT 和 DELETE 都返回 `ResponseEntity.noContent().build()`。`GlobalExceptionHandler` 增加 `HandlerMethodValidationException` 处理器，沿用项目约定返回 HTTP 200 与业务 `code=400`。

Run: `mvn -pl backend -Dtest=ImPushRegistrationControllerTest test`

Expected: PASS。

- [ ] **Step 8: 提交登记功能**

```bash
git add backend/src/main/resources/db/migration/V7__im_push_registration.sql \
  backend/src/main/java/com/rbac/common/web/GlobalExceptionHandler.java \
  backend/src/main/java/com/rbac/im/push/registration \
  backend/src/test/java/com/rbac/im/push/registration
git commit -m "功能(IM推送): 增加设备登记接口"
```

### Task 2: 生成安全摘要并发布推送候选事件

**Files:**
- Create: `backend/src/main/java/com/rbac/im/push/candidate/AppendedMessage.java`
- Create: `backend/src/main/java/com/rbac/im/push/candidate/PushCandidate.java`
- Create: `backend/src/main/java/com/rbac/im/push/candidate/PushPreviewFactory.java`
- Create: `backend/src/main/java/com/rbac/im/push/candidate/PushCandidatePublisher.java`
- Create: `backend/src/main/java/com/rbac/im/push/candidate/KafkaPushCandidatePublisher.java`
- Modify: `backend/src/main/java/com/rbac/im/config/ImKafkaTopics.java`
- Modify: `backend/src/main/java/com/rbac/im/service/MessageAppender.java`
- Modify: `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`
- Modify: `backend/src/test/java/com/rbac/im/service/MessageAppenderTest.java`
- Modify: `backend/src/test/java/com/rbac/im/service/InboundMessageConsumerTest.java`
- Modify: `backend/src/test/java/com/rbac/im/service/InboundMentionTriggerTest.java`
- Modify: `backend/src/test/java/com/rbac/im/service/InboundLinkTriggerTest.java`
- Modify: `backend/src/test/java/com/rbac/im/service/InboundReadTriggerTest.java`
- Test: `backend/src/test/java/com/rbac/im/push/candidate/PushPreviewFactoryTest.java`
- Test: `backend/src/test/java/com/rbac/im/push/candidate/KafkaPushCandidatePublisherTest.java`

**Interfaces:**
- Consumes: `MessageAppender.append(...)`、`MentionService.resolve/apply(...)`、`KafkaTemplate<String, String>`
- Produces: `AppendedMessage(String msgId, long seq, long ts)`、`PushCandidate`、`PushCandidatePublisher.publish(PushCandidate candidate)`、`ImKafkaTopics.PUSH = "im-push"`

- [ ] **Step 1: 写摘要生成失败测试**

```java
@ParameterizedTest
@MethodSource("previews")
void createsSafePreview(String type, Map<String, Object> body, String expected) {
    assertThat(factory.create(type, body)).isEqualTo(expected);
}

static Stream<Arguments> previews() {
    return Stream.of(
        arguments("TEXT", Map.of("text", "第一行\n  第二行"), "第一行 第二行"),
        arguments("IMAGE", Map.of("objectKey", "private/key"), "[图片]"),
        arguments("AUDIO", Map.of("duration", 3), "[语音]"),
        arguments("FILE", Map.of("filename", "合同.pdf"), "[文件]"));
}
```

- [ ] **Step 2: 运行摘要测试并确认失败**

Run: `mvn -pl backend -Dtest=PushPreviewFactoryTest test`

Expected: FAIL，`PushPreviewFactory` 不存在。

- [ ] **Step 3: 实现按 Unicode 码点截断的摘要工厂**

```java
public String create(String type, Map<String, Object> body) {
    if (!"TEXT".equals(type)) return MEDIA_LABELS.get(type);
    String normalized = String.valueOf(body.getOrDefault("text", ""))
            .replaceAll("\\s+", " ").trim();
    int end = normalized.offsetByCodePoints(
            0, Math.min(MAX_CODE_POINTS, normalized.codePointCount(0, normalized.length())));
    return normalized.substring(0, end);
}
```

`MAX_CODE_POINTS` 固定为 120。未知类型返回 `null`，调用方不发布候选事件。

- [ ] **Step 4: 运行摘要测试并确认通过**

Run: `mvn -pl backend -Dtest=PushPreviewFactoryTest test`

Expected: PASS。

- [ ] **Step 5: 写候选事件时序失败测试**

```java
@Test
void publishesCandidateOnlyAfterMentionStateAdvances() throws Exception {
    InOrder order = inOrder(appender, mentionService, pushPublisher);
    when(appender.append(eq("g_100"), eq(10L), eq("TEXT"), any(), eq("cli-1")))
        .thenReturn(new AppendedMessage("msg-7", 7L, 7000L));
    when(mentionService.resolve(eq("g_100"), eq(10L), eq("TEXT"), any()))
        .thenReturn(List.of(20L));

    consumer().onMessage(groupText(Map.of("text", "hi", "mentions", List.of(20))));

    order.verify(appender).append(eq("g_100"), eq(10L), eq("TEXT"), any(), eq("cli-1"));
    order.verify(mentionService).apply("g_100", 7L, List.of(20L));
    order.verify(pushPublisher).publish(argThat(c -> c.msgId().equals("msg-7")));
}
```

- [ ] **Step 6: 修改追加结果和候选发布链**

```java
public record AppendedMessage(String msgId, long seq, long ts) {}

public record PushCandidate(
        int version, String msgId, String cid, long seq, long senderId,
        String type, String preview, List<Long> mentionTargetIds, long ts) {}
```

`MessageAppender.append` 返回 `new AppendedMessage(msgId, seq, ts)`。`InboundMessageConsumer` 只为四种允许类型创建候选事件，并在 `mentionService.apply` 之后调用发布器。

```java
AppendedMessage appended = appender.append(
        env.getCid(), env.getSenderId(), env.getType(), env.getBody(), env.getClientMsgId());
mentionService.apply(env.getCid(), appended.seq(), mentionTargets);
String preview = previewFactory.create(env.getType(), env.getBody());
if (preview != null) {
    pushPublisher.publish(new PushCandidate(1, appended.msgId(), env.getCid(),
            appended.seq(), env.getSenderId(), env.getType(), preview,
            List.copyOf(mentionTargets), appended.ts()));
}
```

- [ ] **Step 7: 实现 Kafka 发布器并验证序列化**

```java
public void publish(PushCandidate candidate) {
    try {
        String json = mapper.writeValueAsString(candidate);
        kafka.send(ImKafkaTopics.PUSH, candidate.cid(), json)
            .whenComplete((ok, cause) -> {
                if (cause != null) log.warn("推送候选发布失败 msgId={}", candidate.msgId());
            });
    } catch (JsonProcessingException e) {
        log.error("推送候选序列化失败 msgId={}", candidate.msgId());
    } catch (RuntimeException e) {
        log.warn("推送候选发布失败 msgId={}", candidate.msgId());
    }
}
```

候选发布属于提醒旁路。序列化或 Kafka 发送失败只记录 `msgId`，不能让已落库消息回滚或让 `im-inbound` 反复消费。测试必须覆盖 `publish` 失败时 `InboundMessageConsumer.onMessage` 仍正常返回。

Run: `mvn -pl backend -Dtest=KafkaPushCandidatePublisherTest,InboundMentionTriggerTest,MessageAppenderTest test`

Expected: PASS，并验证 Kafka key 为 `cid`、Payload 不包含完整 `body`。

- [ ] **Step 8: 修复所有受构造器和返回类型影响的现有测试并运行**

为所有 `InboundMessageConsumer` 测试显式注入 `QuoteService` 和 `PushCandidatePublisher` mock。禁止用兼容重载隐藏漏改的测试。

Run: `mvn -pl backend -Dtest='Inbound*Test,MessageAppenderTest,PushPreviewFactoryTest,KafkaPushCandidatePublisherTest' test`

Expected: PASS。

- [ ] **Step 9: 提交候选事件链**

```bash
git add backend/src/main/java/com/rbac/im/config/ImKafkaTopics.java \
  backend/src/main/java/com/rbac/im/service/MessageAppender.java \
  backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java \
  backend/src/main/java/com/rbac/im/push/candidate \
  backend/src/test/java/com/rbac/im/push/candidate \
  backend/src/test/java/com/rbac/im/service/MessageAppenderTest.java \
  backend/src/test/java/com/rbac/im/service/InboundMessageConsumerTest.java \
  backend/src/test/java/com/rbac/im/service/InboundMentionTriggerTest.java \
  backend/src/test/java/com/rbac/im/service/InboundLinkTriggerTest.java \
  backend/src/test/java/com/rbac/im/service/InboundReadTriggerTest.java
git commit -m "功能(IM推送): 发布消息推送候选事件"
```

### Task 3: 筛选接收人并构建版本化 FCM Payload

**Files:**
- Create: `backend/src/main/java/com/rbac/im/push/delivery/PushTarget.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/PushPresentation.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/PushRecipientResolver.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/PushPresentationService.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/FcmPayloadFactory.java`
- Test: `backend/src/test/java/com/rbac/im/push/delivery/PushRecipientResolverTest.java`
- Test: `backend/src/test/java/com/rbac/im/push/delivery/PushPresentationServiceTest.java`
- Test: `backend/src/test/java/com/rbac/im/push/delivery/FcmPayloadFactoryTest.java`

**Interfaces:**
- Consumes: `PushRegistrationService.findFreshEnabledByUserIds(...)`、`ImConversationMemberMapper`、`SysUserMapper`、`ImGroupMapper`
- Produces: `PushTarget(ImPushRegistration registration, long recipientUserId, boolean mentioned)`、`PushRecipientResolver.resolve(PushCandidate)`、`FcmPayloadFactory.create(PushCandidate, PushTarget, PushPresentation)`

- [ ] **Step 1: 写接收人规则失败测试**

```java
@Test
void resolve_excludesSenderAndMutedOrdinary_butKeepsMutedMention() {
    when(memberMapper.selectList(any())).thenReturn(List.of(
        member(10L, false), member(20L, true), member(30L, true), member(40L, false)));
    when(registrations.findFreshEnabledByUserIds(any(), any())).thenReturn(List.of(
        registration(10L), registration(20L), registration(30L), registration(40L)));

    List<PushTarget> targets = resolver.resolve(candidate(10L, List.of(30L)));

    assertThat(targets).extracting(PushTarget::recipientUserId)
        .containsExactlyInAnyOrder(30L, 40L);
    assertThat(targets.stream().filter(PushTarget::mentioned)
        .map(PushTarget::recipientUserId)).containsExactly(30L);
}
```

- [ ] **Step 2: 运行接收人测试并确认失败**

Run: `mvn -pl backend -Dtest=PushRecipientResolverTest test`

Expected: FAIL，接收人类型不存在。

- [ ] **Step 3: 实现接收人筛选并避免 N+1 查询**

一次查询加载会话成员，一次批量查询加载允许的登记。先在内存计算接收人 ID 集合，再调用 `findFreshEnabledByUserIds`。新鲜阈值固定为当前时间减 30 天，并通过注入的 `Clock` 计算。

```java
Set<Long> mentioned = Set.copyOf(candidate.mentionTargetIds());
Map<Long, Boolean> allowed = memberMapper.selectList(
        new LambdaQueryWrapper<ImConversationMember>()
            .eq(ImConversationMember::getCid, candidate.cid())).stream()
    .filter(member -> member.getUserId() != candidate.senderId())
    .filter(member -> !Integer.valueOf(1).equals(member.getMuted())
            || mentioned.contains(member.getUserId()))
    .collect(toMap(ImConversationMember::getUserId,
            member -> mentioned.contains(member.getUserId())));
return registrations.findFreshEnabledByUserIds(
        allowed.keySet(), LocalDateTime.now(clock).minusDays(30)).stream()
    .map(row -> new PushTarget(row, row.getUserId(), allowed.get(row.getUserId())))
    .toList();
```

- [ ] **Step 4: 运行接收人测试并确认通过**

Run: `mvn -pl backend -Dtest=PushRecipientResolverTest test`

Expected: PASS。

- [ ] **Step 5: 写标题与 Payload 失败测试**

```java
@Test
void groupPayloadContainsAccountBindingAndMentionChannelData() {
    Map<String, String> data = factory.create(
        candidate("g_100", 86L, "今晚八点发布"),
        target(42L, true),
        new PushPresentation("研发群", "张三"));

    assertThat(data).containsEntry("version", "1")
        .containsEntry("recipientUserId", "42")
        .containsEntry("cid", "g_100")
        .containsEntry("seq", "86")
        .containsEntry("title", "研发群")
        .containsEntry("senderName", "张三")
        .containsEntry("mentioned", "true");
    assertThat(new ObjectMapper().writeValueAsBytes(data).length).isLessThan(4096);
}
```

- [ ] **Step 6: 实现展示信息和 Payload 工厂**

单聊标题使用发送人昵称，群聊标题使用 `ImGroup.name`。昵称为空时使用用户名，再为空时使用 `用户 #<id>`。群名为空时使用 `群聊 #<groupId>`。

Payload 必须精确包含设计文档中的 13 个字符串字段，不加入 Token、媒体地址或完整正文。

```java
Map<String, String> data = new LinkedHashMap<>();
data.put("version", "1");
data.put("event", "NEW_MESSAGE");
data.put("recipientUserId", Long.toString(target.recipientUserId()));
data.put("msgId", candidate.msgId());
data.put("cid", candidate.cid());
data.put("seq", Long.toString(candidate.seq()));
data.put("conversationType", candidate.cid().startsWith("g_") ? "GROUP" : "SINGLE");
data.put("groupId", candidate.cid().startsWith("g_") ? candidate.cid().substring(2) : "");
data.put("title", presentation.title());
data.put("senderName", presentation.senderName());
data.put("preview", candidate.preview());
data.put("mentioned", Boolean.toString(target.mentioned()));
data.put("ts", Long.toString(candidate.ts()));
return Map.copyOf(data);
```

- [ ] **Step 7: 运行展示和 Payload 测试**

Run: `mvn -pl backend -Dtest=PushPresentationServiceTest,FcmPayloadFactoryTest test`

Expected: PASS。

- [ ] **Step 8: 提交接收人和 Payload 逻辑**

```bash
git add backend/src/main/java/com/rbac/im/push/delivery/PushTarget.java \
  backend/src/main/java/com/rbac/im/push/delivery/PushPresentation.java \
  backend/src/main/java/com/rbac/im/push/delivery/PushRecipientResolver.java \
  backend/src/main/java/com/rbac/im/push/delivery/PushPresentationService.java \
  backend/src/main/java/com/rbac/im/push/delivery/FcmPayloadFactory.java \
  backend/src/test/java/com/rbac/im/push/delivery/PushRecipientResolverTest.java \
  backend/src/test/java/com/rbac/im/push/delivery/PushPresentationServiceTest.java \
  backend/src/test/java/com/rbac/im/push/delivery/FcmPayloadFactoryTest.java
git commit -m "功能(IM推送): 筛选接收人并生成FCM数据"
```

### Task 4: 接入 Firebase Admin、重试、死信和指标

**Files:**
- Modify: `backend/pom.xml`
- Modify: `backend/src/main/resources/application.yml`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/PushProperties.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/FirebaseAdminConfig.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/FcmGateway.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/FcmRequest.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/FcmSendResult.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/PushFailureKind.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/FirebaseAdminFcmGateway.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/PushDeliveryService.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/PushCandidateConsumer.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/TransientPushException.java`
- Create: `backend/src/main/java/com/rbac/im/push/delivery/PushMetrics.java`
- Test: `backend/src/test/java/com/rbac/im/push/delivery/PushDeliveryServiceTest.java`
- Test: `backend/src/test/java/com/rbac/im/push/delivery/PushMetricsTest.java`
- Test: `backend/src/test/java/com/rbac/im/push/delivery/PushCandidateConsumerTest.java`

**Interfaces:**
- Consumes: `PushRecipientResolver`、`PushPresentationService`、`FcmPayloadFactory`、Firebase Admin 9.10.0
- Produces: `FcmGateway.send(List<FcmRequest>): List<FcmSendResult>`、`PushDeliveryService.deliver(PushCandidate)`、Kafka group `im-push-delivery`

- [ ] **Step 1: 写批处理和错误分类失败测试**

```java
@Test
void deliver_batchesBy500_disablesPermanentTargets_andRetriesTransientOnes() {
    when(resolver.resolve(candidate)).thenReturn(targets(501));
    when(gateway.send(anyList()))
        .thenReturn(resultsWithPermanentFailureAt(3))
        .thenReturn(resultsWithTransientFailureAt(0));

    assertThatThrownBy(() -> service.deliver(candidate))
        .isInstanceOf(TransientPushException.class);

    verify(gateway, times(2)).send(anyList());
    verify(registrations).disableTargetHash("hash-3");
}
```

- [ ] **Step 2: 运行发送测试并确认失败**

Run: `mvn -pl backend -Dtest=PushDeliveryServiceTest test`

Expected: FAIL，FCM 网关和发送服务不存在。

发送边界使用以下精确类型：

```java
public record FcmRequest(
        String targetType, String targetValue, String targetHash,
        Map<String, String> data) {}

public enum PushFailureKind { NONE, PERMANENT, TRANSIENT }

public record FcmSendResult(
        boolean success, PushFailureKind failureKind, String reason) {}

public interface FcmGateway {
    List<FcmSendResult> send(List<FcmRequest> requests);
}
```

- [ ] **Step 3: 添加 Admin SDK 和配置约束**

```xml
<dependency>
    <groupId>com.google.firebase</groupId>
    <artifactId>firebase-admin</artifactId>
    <version>9.10.0</version>
</dependency>
```

```yaml
rbac:
  im:
    push:
      enabled: ${IM_PUSH_ENABLED:false}
      fresh-days: 30
      ttl-seconds: 86400
```

`FirebaseAdminConfig` 仅在 `rbac.im.push.enabled=true` 时通过 `GoogleCredentials.getApplicationDefault()` 初始化。禁止读取仓库内的服务账号 JSON 路径。

- [ ] **Step 4: 实现 FCM 网关和最多 500 条分批**

```java
Message message = Message.builder()
    .setFid(request.targetValue())
    .setAndroidConfig(AndroidConfig.builder()
        .setPriority(AndroidConfig.Priority.HIGH)
        .setTtl(properties.ttlSeconds() * 1000L)
        .putAllData(request.data())
        .build())
    .build();
```

`targetType=TOKEN` 只走兼容分支 `setToken`，新登记默认走 `setFid`。使用 `FirebaseMessaging.sendEach(messages)`，并把 `MessagingErrorCode.UNREGISTERED` 归类为永久失败；`UNAVAILABLE`、`INTERNAL` 和配额类错误归类为临时失败。日志只包含 `msgId` 和错误分类。

- [ ] **Step 5: 运行发送测试并确认通过**

Run: `mvn -pl backend -Dtest=PushDeliveryServiceTest test`

Expected: PASS。

- [ ] **Step 6: 写 Kafka 重试与死信失败测试**

```java
@Test
void transientFailureEscapesListenerForRetry() throws Exception {
    doThrow(new TransientPushException("UNAVAILABLE")).when(delivery).deliver(candidate);
    assertThatThrownBy(() -> consumer.onMessage(mapper.writeValueAsString(candidate)))
        .isInstanceOf(TransientPushException.class);
}

@Test
void dltRecordsFailureWithoutPayloadText() {
    consumer.onDlt("msg-1", "UNAVAILABLE");
    assertThat(registry.get("im.push.dlt", "reason", "UNAVAILABLE").counter().count())
        .isEqualTo(1);
}
```

- [ ] **Step 7: 实现有界随机退避和 DLT**

```java
@RetryableTopic(
    attempts = "4",
    backoff = @Backoff(delay = 1000, multiplier = 2.0, maxDelay = 30000, random = true),
    dltTopicSuffix = ".DLT")
@KafkaListener(topics = ImKafkaTopics.PUSH, groupId = "im-push-delivery")
public void onMessage(String json) throws JsonProcessingException {
    delivery.deliver(mapper.readValue(json, PushCandidate.class));
}
```

`@DltHandler` 只记录 `msgId`、错误分类和计数，不记录候选 JSON。

- [ ] **Step 8: 实现低基数 Micrometer 指标并运行测试**

指标名固定为 `im.push.candidates`、`im.push.targets`、`im.push.delivery`、`im.push.latency`。Tag 只允许 `result`、`reason`、`stage` 的枚举值。

Run: `mvn -pl backend -Dtest=PushCandidateConsumerTest,PushMetricsTest test`

Expected: PASS。

- [ ] **Step 9: 运行后端推送测试集合并提交**

Run: `mvn -pl backend -Dtest='Push*Test,Fcm*Test,ImPush*Test' test`

Expected: PASS，且测试不访问真实 FCM。

```bash
git add backend/pom.xml backend/src/main/resources/application.yml \
  backend/src/main/java/com/rbac/im/push/delivery/PushProperties.java \
  backend/src/main/java/com/rbac/im/push/delivery/FirebaseAdminConfig.java \
  backend/src/main/java/com/rbac/im/push/delivery/FcmGateway.java \
  backend/src/main/java/com/rbac/im/push/delivery/FcmRequest.java \
  backend/src/main/java/com/rbac/im/push/delivery/FcmSendResult.java \
  backend/src/main/java/com/rbac/im/push/delivery/PushFailureKind.java \
  backend/src/main/java/com/rbac/im/push/delivery/FirebaseAdminFcmGateway.java \
  backend/src/main/java/com/rbac/im/push/delivery/PushDeliveryService.java \
  backend/src/main/java/com/rbac/im/push/delivery/PushCandidateConsumer.java \
  backend/src/main/java/com/rbac/im/push/delivery/TransientPushException.java \
  backend/src/main/java/com/rbac/im/push/delivery/PushMetrics.java \
  backend/src/test/java/com/rbac/im/push/delivery/PushDeliveryServiceTest.java \
  backend/src/test/java/com/rbac/im/push/delivery/PushMetricsTest.java \
  backend/src/test/java/com/rbac/im/push/delivery/PushCandidateConsumerTest.java
git commit -m "功能(IM推送): 接入FCM异步发送链"
```

### Task 5: 接入 Android Firebase 并实现原生 Payload、账号和去重状态

**Files:**
- Modify: `.gitignore`
- Modify: `im-client/packages/app-mobile/android/build.gradle`
- Modify: `im-client/packages/app-mobile/android/app/build.gradle`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/model/PushPayload.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/store/KeyValueStore.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/store/SharedPreferencesKeyValueStore.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/store/PushStateStore.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/AppVisibilityTracker.kt`
- Test: `im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/model/PushPayloadTest.kt`
- Test: `im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/store/PushStateStoreTest.kt`

**Interfaces:**
- Consumes: Firebase Android BoM 34.16.0、Firebase Messaging、Firebase Installations
- Produces: `PushPayload.parse(Map<String, String>): PushPayload?`、`PushStateStore`、`AppVisibilityTracker.isForeground`

- [ ] **Step 1: 写严格 Payload 解析失败测试**

```kotlin
@Test fun parseRejectsMissingAccountAndOversizedPreview() {
  assertNull(PushPayload.parse(validData() - "recipientUserId"))
  assertNull(PushPayload.parse(validData() + ("preview" to "x".repeat(241))))
}

@Test fun parseAcceptsVersionOneMessage() {
  val payload = PushPayload.parse(validData())
  assertEquals("msg-1", payload?.msgId)
  assertEquals(86L, payload?.seq)
  assertTrue(payload?.mentioned == true)
}
```

- [ ] **Step 2: 运行 Android 单元测试并确认失败**

Run: `cd im-client/packages/app-mobile/android && ./gradlew testDebugUnitTest --tests '*PushPayloadTest'`

Expected: FAIL，`PushPayload` 不存在。

- [ ] **Step 3: 添加固定版本依赖和缺配置可编译开关**

项目级 Gradle 添加：

```groovy
classpath("com.google.gms:google-services:4.5.0")
```

App 级 Gradle 添加：

```groovy
if (file("google-services.json").exists()) {
    apply plugin: "com.google.gms.google-services"
}

implementation(platform("com.google.firebase:firebase-bom:34.16.0"))
implementation("com.google.firebase:firebase-messaging")
implementation("com.google.firebase:firebase-installations")
testImplementation("junit:junit:4.13.2")
```

在仓库根 `.gitignore` 增加 `**/google-services.json`。不生成假的 Firebase 配置文件。

- [ ] **Step 4: 实现纯 Kotlin Payload 解析器**

只接受 `version=1` 和 `event=NEW_MESSAGE`。限制：`msgId` 128 字符、`cid` 64 字符、标题 128 字符、发送人 128 字符、摘要 240 字符；`seq`、`recipientUserId`、`ts` 必须为非负整数。

```kotlin
data class PushPayload(
  val recipientUserId: Long, val msgId: String, val cid: String, val seq: Long,
  val conversationType: String, val groupId: Long?, val title: String,
  val senderName: String, val preview: String, val mentioned: Boolean, val ts: Long,
) {
companion object {
  fun parse(data: Map<String, String>): PushPayload? {
    if (data["version"] != "1" || data["event"] != "NEW_MESSAGE") return null
    val recipient = data["recipientUserId"]?.toLongOrNull()?.takeIf { it >= 0 } ?: return null
    val seq = data["seq"]?.toLongOrNull()?.takeIf { it >= 0 } ?: return null
    val ts = data["ts"]?.toLongOrNull()?.takeIf { it >= 0 } ?: return null
    val msgId = data["msgId"]?.takeIf { it.isNotBlank() && it.length <= 128 } ?: return null
    val cid = data["cid"]?.takeIf { it.isNotBlank() && it.length <= 64 } ?: return null
    val type = data["conversationType"]?.takeIf { it == "SINGLE" || it == "GROUP" } ?: return null
    val title = data["title"]?.takeIf { it.isNotBlank() && it.length <= 128 } ?: return null
    val sender = data["senderName"]?.takeIf { it.isNotBlank() && it.length <= 128 } ?: return null
    val preview = data["preview"]?.takeIf { it.length <= 240 } ?: return null
    val groupId = data["groupId"]?.toLongOrNull()?.takeIf { it >= 0 }
    if (type == "GROUP" && groupId == null) return null
    return PushPayload(recipient, msgId, cid, seq, type, groupId,
      title, sender, preview, data["mentioned"] == "true", ts)
  }
}
}
```

- [ ] **Step 5: 写账号和去重状态失败测试**

```kotlin
@Test fun accountMismatchAndDuplicateAreRejected() {
  store.setActiveUserId(42L)
  assertTrue(store.matchesAccount(42L))
  assertFalse(store.matchesAccount(41L))
  assertTrue(store.markIfNew("msg-1", nowMs = 1000L))
  assertFalse(store.markIfNew("msg-1", nowMs = 1001L))
}
```

- [ ] **Step 6: 实现有界原生状态和前台跟踪**

`PushStateStore` 通过注入的 `KeyValueStore` 测试，生产适配器使用名为 `im_push_state` 的 SharedPreferences。最多保留 512 个 `msgId`，并删除 48 小时前记录。账号使用单独 Key；`clearActiveUserId()` 不清空去重集合。状态存储同时提供 `enqueueOpen`、`consumeOpen`、`enqueueForegroundMessage`、`consumeForegroundMessage`、`markSyncAllRequired` 和 `consumeSyncAllRequired`，供后续 FCM 服务与 React 桥解耦使用。

`AppVisibilityTracker` 实现 `Application.ActivityLifecycleCallbacks`，只在至少一个 Activity 处于 `onActivityResumed` 后返回前台。

```kotlin
interface KeyValueStore {
  fun getString(key: String): String?
  fun putString(key: String, value: String)
  fun remove(key: String)
}

fun markIfNew(msgId: String, nowMs: Long): Boolean {
  val retained = readSeen().filterValues { nowMs - it <= SEEN_TTL_MS }.toMutableMap()
  if (retained.containsKey(msgId)) return false
  retained[msgId] = nowMs
  writeSeen(retained.entries.sortedByDescending { it.value }.take(MAX_SEEN))
  return true
}
```

- [ ] **Step 7: 运行原生状态测试并提交**

Run: `cd im-client/packages/app-mobile/android && ./gradlew testDebugUnitTest --tests 'com.appmobile.push.*'`

Expected: PASS。

```bash
git add .gitignore \
  im-client/packages/app-mobile/android/build.gradle \
  im-client/packages/app-mobile/android/app/build.gradle \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/model/PushPayload.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/store/KeyValueStore.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/store/SharedPreferencesKeyValueStore.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/store/PushStateStore.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/AppVisibilityTracker.kt \
  im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/model/PushPayloadTest.kt \
  im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/store/PushStateStoreTest.kt
git commit -m "功能(Android推送): 接入Firebase与原生推送状态"
```

### Task 6: 生成 Android 通知并处理 FCM 服务

**Files:**
- Modify: `im-client/packages/app-mobile/android/app/src/main/AndroidManifest.xml`
- Modify: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/MainApplication.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/res/drawable/ic_stat_message.xml`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/model/NotificationSpec.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/model/NotificationSpecFactory.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/notification/ConversationNotificationStore.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/notification/NotificationCoordinator.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/notification/NotificationChannels.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/ImPushMessageLogic.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/ImFirebaseMessagingService.kt`
- Test: `im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/model/NotificationSpecFactoryTest.kt`
- Test: `im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/ImFirebaseMessagingServiceLogicTest.kt`

**Interfaces:**
- Consumes: `PushPayload`、`PushStateStore`、`AppVisibilityTracker`
- Produces: `NotificationSpecFactory.create(PushPayload)`、渠道 `messages`/`mentions`、后台系统通知、前台同步事件

- [ ] **Step 1: 写通知模型失败测试**

```kotlin
@Test fun groupMessageUsesGroupTitleAndSenderPrefix() {
  val spec = factory.create(groupPayload(mentioned = true))
  assertEquals("研发群", spec.title)
  assertEquals("张三：今晚八点发布", spec.body)
  assertEquals("mentions", spec.channelId)
  assertEquals(stableId("g_100"), spec.notificationId)
}
```

- [ ] **Step 2: 运行通知模型测试并确认失败**

Run: `cd im-client/packages/app-mobile/android && ./gradlew testDebugUnitTest --tests '*NotificationSpecFactoryTest'`

Expected: FAIL，通知模型不存在。

- [ ] **Step 3: 实现通知模型、渠道和图标**

单聊正文只使用 `preview`，群聊正文使用 `senderName：preview`。通知 ID 使用稳定的 `cid.hashCode() and 0x7fffffff`。渠道 ID 固定，`messages` 使用 `IMPORTANCE_DEFAULT`，`mentions` 使用 `IMPORTANCE_HIGH`。

```kotlin
data class NotificationSpec(
  val notificationId: Int,
  val channelId: String,
  val title: String,
  val body: String,
  val groupKey: String,
)

fun create(payload: PushPayload): NotificationSpec = NotificationSpec(
  notificationId = payload.cid.hashCode() and 0x7fffffff,
  channelId = if (payload.mentioned) NotificationChannels.MENTIONS else NotificationChannels.MESSAGES,
  title = payload.title,
  body = if (payload.conversationType == "GROUP")
    "${payload.senderName}：${payload.preview}" else payload.preview,
  groupKey = "im_messages",
)
```

- [ ] **Step 4: 写服务决策失败测试**

```kotlin
@Test fun foregroundEmitsSyncWithoutPostingNotification() {
  val result = logic.handle(validPayload(), activeUser = 42L, foreground = true)
  assertEquals(Action.EMIT_FOREGROUND_SYNC, result.action)
}

@Test fun backgroundAccountMismatchIsDropped() {
  val result = logic.handle(validPayload(), activeUser = 41L, foreground = false)
  assertEquals(Action.DROP_ACCOUNT_MISMATCH, result.action)
}
```

决策类型固定如下，避免 Firebase Service、状态存储和通知协调器互相耦合：

```kotlin
enum class Action {
  EMIT_FOREGROUND_SYNC,
  SHOW_NOTIFICATION,
  DROP_ACCOUNT_MISMATCH,
  DROP_DUPLICATE,
}

data class HandlingResult(val action: Action, val payload: PushPayload)

fun handle(payload: PushPayload, activeUser: Long?, foreground: Boolean): HandlingResult {
  if (activeUser == null || activeUser != payload.recipientUserId) {
    return HandlingResult(Action.DROP_ACCOUNT_MISMATCH, payload)
  }
  if (!state.markIfNew(payload.msgId, clock.millis())) {
    return HandlingResult(Action.DROP_DUPLICATE, payload)
  }
  return HandlingResult(
    if (foreground) Action.EMIT_FOREGROUND_SYNC else Action.SHOW_NOTIFICATION,
    payload,
  )
}
```

- [ ] **Step 5: 实现 FCM 服务和通知协调器**

Manifest 增加 `POST_NOTIFICATIONS` 和未导出的 `ImFirebaseMessagingService`：

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<service
  android:name=".push.ImFirebaseMessagingService"
  android:exported="false">
  <intent-filter>
    <action android:name="com.google.firebase.MESSAGING_EVENT" />
  </intent-filter>
</service>
```

服务按“解析、账号匹配、去重、前后台决策”的顺序执行。后台使用 `NotificationCompat.InboxStyle` 更新每个会话的单条通知，`setVisibility(NotificationCompat.VISIBILITY_PRIVATE)`，并设置公共 group key `im_messages`。权限关闭时不调用 `notify()`。

`ConversationNotificationStore` 按 `cid` 保存最多 5 条摘要和总计数，最多保留 50 个会话；`NotificationCoordinator.clearConversation(cid)` 同时删除系统通知和该会话摘要。

通知点击使用指向 `MainActivity` 的显式 `Intent`，只附带 `source=im_notification`、`recipientUserId`、`cid`、`conversationType`、可选 `groupId` 和 `title`。`PendingIntent` 的 request code 使用通知 ID，并设置 `FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE`；禁止把 `preview`、目标值或完整 Payload 放进 Intent。

```kotlin
override fun onMessageReceived(message: RemoteMessage) {
  val payload = PushPayload.parse(message.data) ?: return
  when (logic.handle(payload, state.activeUserId(), AppVisibilityTracker.isForeground)) {
    Action.EMIT_FOREGROUND_SYNC -> state.enqueueForegroundMessage(payload.cid)
    Action.SHOW_NOTIFICATION -> coordinator.show(payload)
    Action.DROP_ACCOUNT_MISMATCH, Action.DROP_DUPLICATE -> Unit
  }
}
```

- [ ] **Step 6: 实现 `onDeletedMessages` 同步提示**

服务把 `SYNC_ALL_REQUIRED` 写入原生待处理事件存储。下一次 React Native 桥初始化或 App 回到前台时只发送一次该事件。

```kotlin
override fun onDeletedMessages() {
  PushStateStore.create(applicationContext).markSyncAllRequired()
}
```

- [ ] **Step 7: 在 Application 注册生命周期并创建渠道**

```kotlin
override fun onCreate() {
  super.onCreate()
  registerActivityLifecycleCallbacks(AppVisibilityTracker)
  NotificationChannels.create(this)
  loadReactNative(this)
}
```

- [ ] **Step 8: 运行原生测试并提交**

Run: `cd im-client/packages/app-mobile/android && ./gradlew testDebugUnitTest --tests 'com.appmobile.push.*'`

Expected: PASS。

```bash
git add im-client/packages/app-mobile/android/app/src/main/AndroidManifest.xml \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/MainApplication.kt \
  im-client/packages/app-mobile/android/app/src/main/res/drawable/ic_stat_message.xml \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/model/NotificationSpec.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/model/NotificationSpecFactory.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/notification/ConversationNotificationStore.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/notification/NotificationCoordinator.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/notification/NotificationChannels.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/ImPushMessageLogic.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/ImFirebaseMessagingService.kt \
  im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/model/NotificationSpecFactoryTest.kt \
  im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/ImFirebaseMessagingServiceLogicTest.kt
git commit -m "功能(Android推送): 显示分组消息通知"
```

### Task 7: 建立 React Native 原生桥并传递通知点击事件

**Files:**
- Modify: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/MainActivity.kt`
- Modify: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/MainApplication.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/bridge/PushEventQueue.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/bridge/PushNotificationModule.kt`
- Create: `im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/bridge/PushNotificationPackage.kt`
- Create: `im-client/packages/app-mobile/src/push/nativePush.ts`
- Test: `im-client/packages/app-mobile/__tests__/nativePush.test.ts`
- Test: `im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/bridge/PushEventQueueTest.kt`

**Interfaces:**
- Consumes: `FirebaseInstallations.getInstance().id`、MainActivity Intent extras、`PushStateStore`
- Produces: JS 模块 `PushNotification`、事件 `foregroundMessage`/`notificationOpened`/`syncAllRequired`

- [ ] **Step 1: 写 TypeScript 适配器失败测试**

```typescript
test('normalizes registration target and native events', async () => {
  NativeModules.PushNotification.getRegistrationTarget.mockResolvedValue({
    targetType: 'FID', targetValue: 'fid-a',
    targetFingerprint: 'hash-a', appVersion: '1.0',
  });
  await expect(nativePush.getRegistrationTarget()).resolves.toEqual({
    targetType: 'FID', targetValue: 'fid-a',
    targetFingerprint: 'hash-a', appVersion: '1.0',
  });
});
```

- [ ] **Step 2: 运行适配器测试并确认失败**

Run: `cd im-client/packages/app-mobile && npm test -- --runInBand __tests__/nativePush.test.ts`

Expected: FAIL，`nativePush` 不存在。

- [ ] **Step 3: 定义精确原生模块接口**

```typescript
export interface PushOpenEvent {
  recipientUserId: number;
  cid: string;
  conversationType: 'SINGLE' | 'GROUP';
  groupId?: number;
  title: string;
}

export interface RegistrationTarget {
  targetType: 'FID';
  targetValue: string;
  targetFingerprint: string;
  appVersion: string;
}
```

适配器提供 `getRegistrationTarget(): Promise<RegistrationTarget | null>`、`setActiveUserId`、`clearActiveUserId`、`areNotificationsEnabled`、`getInitialOpenEvent`、`clearConversationNotification` 和事件订阅函数。非 Android 平台返回 `null`，不抛初始化错误。

- [ ] **Step 4: 写原生事件队列失败测试**

```kotlin
@Test fun consumeOpenReturnsLatestOnce() {
  queue.enqueue(open("c_1_2"))
  queue.enqueue(open("g_100"))
  assertEquals("g_100", queue.consumeOpen()?.cid)
  assertNull(queue.consumeOpen())
}
```

- [ ] **Step 5: 实现桥、事件队列和 Firebase 安装 ID 查询**

`getRegistrationTarget` 先检查 `FirebaseApp.getApps(context)`。没有 Firebase 配置时 Promise 返回 `null`；有配置时调用 `FirebaseInstallations.getInstance().id`，不调用旧 token API。原生层同时返回 FID 的 SHA-256 `targetFingerprint`，并从 `PackageManager` 返回 `versionName` 作为 `appVersion`。

```kotlin
@ReactMethod
fun getRegistrationTarget(promise: Promise) {
  if (FirebaseApp.getApps(reactApplicationContext).isEmpty()) {
    promise.resolve(null)
    return
  }
FirebaseInstallations.getInstance().id
    .addOnSuccessListener { fid -> promise.resolve(registrationMap(fid)) }
    .addOnFailureListener { promise.resolve(null) }
}

private fun registrationMap(fid: String): WritableMap = Arguments.createMap().apply {
  putString("targetType", "FID")
  putString("targetValue", fid)
  putString("targetFingerprint", sha256Hex(fid))
  putString("appVersion", reactApplicationContext.packageManager
    .getPackageInfo(reactApplicationContext.packageName, 0).versionName ?: "unknown")
}

private fun sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
  .digest(value.toByteArray(StandardCharsets.UTF_8))
  .joinToString("") { "%02x".format(it) }
```

`PushEventQueue` 在 React Context 未就绪时持久化最近一次打开事件和一次全量同步标记。React Context 就绪后使用 `DeviceEventManagerModule.RCTDeviceEventEmitter` 发送并消费。

- [ ] **Step 6: 注册原生包并处理 Activity Intent**

`MainApplication` 在 `PackageList(this).packages.apply` 中加入 `PushNotificationPackage()`。`MainActivity.onCreate` 与 `onNewIntent` 调用同一私有方法，只接受 `source=im_notification` 且字段通过 `PushPayload` 导航子集校验的显式 Intent。

```kotlin
override fun onNewIntent(intent: Intent) {
  super.onNewIntent(intent)
  setIntent(intent)
  acceptNotificationIntent(intent)
}

private fun acceptNotificationIntent(intent: Intent?) {
  if (intent?.getStringExtra("source") != "im_notification") return
  val recipient = intent.getLongExtra("recipientUserId", -1L).takeIf { it >= 0 } ?: return
  val cid = intent.getStringExtra("cid")?.takeIf { it.length in 1..64 } ?: return
  val type = intent.getStringExtra("conversationType")
    ?.takeIf { it == "SINGLE" || it == "GROUP" } ?: return
  val title = intent.getStringExtra("title")?.takeIf { it.length in 1..128 } ?: return
  PushEventQueue(applicationContext).enqueue(
    PushOpenEvent(recipient, cid, type, intent.getLongExtra("groupId", -1L)
      .takeIf { it >= 0 }, title))
}
```

- [ ] **Step 7: 运行桥接测试并提交**

Run: `cd im-client/packages/app-mobile && npm test -- --runInBand __tests__/nativePush.test.ts`

Run: `cd im-client/packages/app-mobile/android && ./gradlew testDebugUnitTest --tests '*PushEventQueueTest'`

Expected: PASS。

```bash
git add im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/MainActivity.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/MainApplication.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/bridge/PushEventQueue.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/bridge/PushNotificationModule.kt \
  im-client/packages/app-mobile/android/app/src/main/java/com/appmobile/push/bridge/PushNotificationPackage.kt \
  im-client/packages/app-mobile/android/app/src/test/java/com/appmobile/push/bridge/PushEventQueueTest.kt \
  im-client/packages/app-mobile/src/push/nativePush.ts \
  im-client/packages/app-mobile/__tests__/nativePush.test.ts
git commit -m "功能(Android推送): 桥接FCM与通知点击事件"
```

### Task 8: 接入设备登记、权限时机和退出登录清理

**Files:**
- Modify: `im-client/packages/im-sdk-rn/src/createSdk.ts`
- Create: `im-client/packages/app-mobile/src/push/pushRegistration.ts`
- Create: `im-client/packages/app-mobile/src/push/pushPermission.ts`
- Modify: `im-client/packages/app-mobile/src/store.ts`
- Modify: `im-client/packages/app-mobile/src/screens/ProfileScreen.tsx`
- Test: `im-client/packages/app-mobile/__tests__/pushRegistration.test.ts`
- Test: `im-client/packages/app-mobile/__tests__/pushPermission.test.ts`
- Modify: `im-client/packages/app-mobile/__tests__/ProfileScreen.test.tsx`
- Modify: `im-client/packages/app-mobile/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `sdk.http`、`sdk.installationDeviceId()`、`nativePush`、`PermissionsAndroid`
- Produces: `PushRegistrationManager.activate(userId)`、`deactivate()`、`refreshIfDue()`、权限提示决策

- [ ] **Step 1: 写登记生命周期失败测试**

```typescript
test('activate registers the same installation id used by websocket', async () => {
  sdk.installationDeviceId.mockResolvedValue('device-a');
  nativePush.getRegistrationTarget.mockResolvedValue({
    targetType: 'FID', targetValue: 'fid-a',
    targetFingerprint: 'hash-a', appVersion: '1.0',
  });
  nativePush.areNotificationsEnabled.mockResolvedValue(true);

  await manager.activate(42);

  expect(sdk.http.put).toHaveBeenCalledWith(
    '/im/push/registrations/device-a',
    expect.objectContaining({ targetType: 'FID', targetValue: 'fid-a' }),
  );
  expect(nativePush.setActiveUserId).toHaveBeenCalledWith(42);
});

test('deactivateClearsNativeAccountBeforeBestEffortDelete', async () => {
  await manager.deactivate();
  expect(nativePush.clearActiveUserId.mock.invocationCallOrder[0])
    .toBeLessThan(sdk.http.delete.mock.invocationCallOrder[0]);
});
```

- [ ] **Step 2: 运行登记测试并确认失败**

Run: `cd im-client/packages/app-mobile && npm test -- --runInBand __tests__/pushRegistration.test.ts`

Expected: FAIL，登记管理器和 SDK 安装 ID 接口不存在。

- [ ] **Step 3: 暴露现有安装 ID 并实现登记管理器**

`createSdk` 返回对象新增 `installationDeviceId: getInstallationDeviceId`，禁止复制设备 ID 生成逻辑。

登记请求体精确使用：

```typescript
{
  platform: 'ANDROID',
  provider: 'FCM',
  targetType: target.targetType,
  targetValue: target.targetValue,
  appVersion: target.appVersion,
}
```

管理器通过 AsyncStorage 保存 `im.push.lastRegistrationAt` 和原生返回的 `targetFingerprint`，不保存 FID 原文。目标变化时立即刷新；其余情况七天内不重复请求。登录和恢复登录态仍各执行一次幂等登记。所有自动登记失败只记录脱敏错误并保持聊天可用。

- [ ] **Step 4: 写权限提示决策失败测试**

```typescript
test.each([
  [{ androidVersion: 32, prompted: false, enabled: true }, false],
  [{ androidVersion: 33, prompted: false, enabled: false }, true],
  [{ androidVersion: 33, prompted: true, enabled: false }, false],
])('shouldPrompt(%o) is %s', (input, expected) => {
  expect(shouldPromptForNotifications(input)).toBe(expected);
});
```

- [ ] **Step 5: 实现登录后一次性解释和系统权限请求**

Android 13 及以上首次成功登录后使用 `Alert.alert` 解释“用于在应用后台提醒新消息”。用户选择开启后调用 `PermissionsAndroid.request(POST_NOTIFICATIONS)`，无论允许或拒绝都写入 `im.push.permissionPrompted=true`，避免重复弹窗。

权限允许后调用 `manager.activate(userId)`。Android 12 及以下直接登记。系统通知开关关闭时不登记，并在下次前台调用 `deactivate()`。

```typescript
export interface PromptState {
  androidVersion: number;
  prompted: boolean;
  enabled: boolean;
}

export function shouldPromptForNotifications(input: PromptState): boolean {
  return Platform.OS === 'android'
    && input.androidVersion >= 33
    && !input.prompted
    && !input.enabled;
}

const result = await PermissionsAndroid.request(
  PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
);
await AsyncStorage.setItem(PROMPTED_KEY, 'true');
if (result === PermissionsAndroid.RESULTS.GRANTED) await manager.activate(userId);
```

- [ ] **Step 6: 按安全顺序接入 store 登录、恢复和退出**

登录或恢复成功后先设置应用账号，再异步执行权限与登记流程。退出流程修改为：

```typescript
await pushRegistration.deactivate().catch(() => {});
await sdk.voice.recording.cancel().catch(() => {});
sdk.connection.stop();
await sdk.auth.logout();
set({ loggedIn: false, myId: null, displayName: null });
```

`deactivate()` 内部必须先清原生账号，再尝试服务端 DELETE。

- [ ] **Step 7: 在“我的”页显示通知系统状态**

新增“通知”偏好行，值为“已开启”或“已关闭”。点击后调用 `Linking.openSettings()`，不新增没有内容的设置页面。

```tsx
<PreferenceRow
  icon="notifications-outline"
  label="通知"
  value={notificationsEnabled ? '已开启' : '已关闭'}
  accessibilityLabel="打开系统通知设置"
  onPress={() => void Linking.openSettings()}
  showDivider
/>
```

- [ ] **Step 8: 运行应用层测试并提交**

Run: `cd im-client/packages/app-mobile && npm test -- --runInBand __tests__/pushRegistration.test.ts __tests__/pushPermission.test.ts __tests__/ProfileScreen.test.tsx __tests__/App.test.tsx`

Expected: PASS。

```bash
git add im-client/packages/im-sdk-rn/src/createSdk.ts \
  im-client/packages/app-mobile/src/push/nativePush.ts \
  im-client/packages/app-mobile/src/push/pushRegistration.ts \
  im-client/packages/app-mobile/src/push/pushPermission.ts \
  im-client/packages/app-mobile/src/store.ts \
  im-client/packages/app-mobile/src/screens/ProfileScreen.tsx \
  im-client/packages/app-mobile/__tests__/pushRegistration.test.ts \
  im-client/packages/app-mobile/__tests__/pushPermission.test.ts \
  im-client/packages/app-mobile/__tests__/ProfileScreen.test.tsx \
  im-client/packages/app-mobile/__tests__/App.test.tsx
git commit -m "功能(IM客户端): 管理推送登记与通知权限"
```

### Task 9: 处理前台同步和通知点击导航

**Files:**
- Create: `im-client/packages/app-mobile/src/navigation/navigationRef.ts`
- Create: `im-client/packages/app-mobile/src/push/PushCoordinator.tsx`
- Create: `im-client/packages/app-mobile/src/push/pushNavigation.ts`
- Modify: `im-client/packages/app-mobile/App.tsx`
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`
- Test: `im-client/packages/app-mobile/__tests__/pushNavigation.test.ts`
- Test: `im-client/packages/app-mobile/__tests__/PushCoordinator.test.tsx`
- Modify: `im-client/packages/app-mobile/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `nativePush` 三类事件、`sdk.sync.syncConversation`、`sdk.sync.syncAll`、`RootStackParamList`
- Produces: `navigationRef`、`PushNavigationQueue.accept/flush`、通知打开和前台同步协调器

- [ ] **Step 1: 写待处理导航状态机失败测试**

```typescript
test('waitsForBootAuthAndNavigation_thenOpensMatchingConversation', () => {
  queue.accept(openEvent({ recipientUserId: 42, cid: 'g_100' }));
  expect(queue.flush({ booted: true, myId: null, ready: true })).toBeNull();
  expect(queue.flush({ booted: true, myId: 42, ready: false })).toBeNull();
  expect(queue.flush({ booted: true, myId: 42, ready: true })).toEqual({
    name: 'Chat',
    params: expect.objectContaining({ cid: 'g_100', syncOnOpen: true }),
  });
});

test('dropsEventWhenAnotherAccountIsAlreadyLoggedIn', () => {
  queue.accept(openEvent({ recipientUserId: 42, cid: 'c_1_2' }));
  expect(queue.flush({ booted: true, myId: 99, ready: true })).toBeNull();
  expect(queue.hasPending()).toBe(false);
});
```

- [ ] **Step 2: 运行导航测试并确认失败**

Run: `cd im-client/packages/app-mobile && npm test -- --runInBand __tests__/pushNavigation.test.ts`

Expected: FAIL，导航队列不存在。

- [ ] **Step 3: 实现导航引用和纯状态机**

```typescript
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
```

状态机最多保存一个打开事件。已登录账号不匹配时立即丢弃；未登录时保留到同账号登录；成功生成导航动作后立即消费。

- [ ] **Step 4: 写协调器事件失败测试**

```typescript
test('foregroundMessageTriggersConversationSyncWithoutNavigation', async () => {
  emit('foregroundMessage', { cid: 'c_1_2' });
  await flushPromises();
  expect(sdk.sync.syncConversation).toHaveBeenCalledWith('c_1_2');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('syncAllRequiredUsesExistingFullSync', async () => {
  emit('syncAllRequired', {});
  await flushPromises();
  expect(sdk.sync.syncAll).toHaveBeenCalled();
});
```

- [ ] **Step 5: 实现 `PushCoordinator` 并接入 NavigationContainer**

`NavigationContainer` 增加 `ref={navigationRef}` 和 `onReady`。`PushCoordinator` 在 boot、账号或导航就绪状态变化时调用 `flush`，并订阅三类原生事件。

所有同步 Promise 都捕获错误，让现有 `syncState` 事件负责 UI 错误。通知文案不能写入 SQLite。

```tsx
useEffect(() => {
  const offForeground = nativePush.onForegroundMessage(({ cid }) => {
    void sdk.sync.syncConversation(cid).catch(() => {});
  });
  const offSyncAll = nativePush.onSyncAllRequired(() => {
    void sdk.sync.syncAll().catch(() => {});
  });
  const offOpen = nativePush.onNotificationOpened(event => queue.accept(event));
  return () => { offForeground(); offSyncAll(); offOpen(); };
}, []);
```

- [ ] **Step 6: 打开会话时清除对应原生通知**

`ChatScreen` 的会话进入 effect 调用 `nativePush.clearConversationNotification(cid)`。清除失败不能阻止消息加载。

```typescript
useEffect(() => {
  void nativePush.clearConversationNotification(cid).catch(() => {});
}, [cid]);
```

- [ ] **Step 7: 运行导航与 App 回归测试并提交**

Run: `cd im-client/packages/app-mobile && npm test -- --runInBand __tests__/pushNavigation.test.ts __tests__/PushCoordinator.test.tsx __tests__/App.test.tsx`

Expected: PASS。

```bash
git add im-client/packages/app-mobile/App.tsx \
  im-client/packages/app-mobile/src/navigation/navigationRef.ts \
  im-client/packages/app-mobile/src/push/PushCoordinator.tsx \
  im-client/packages/app-mobile/src/push/pushNavigation.ts \
  im-client/packages/app-mobile/src/screens/ChatScreen.tsx \
  im-client/packages/app-mobile/__tests__/pushNavigation.test.ts \
  im-client/packages/app-mobile/__tests__/PushCoordinator.test.tsx \
  im-client/packages/app-mobile/__tests__/App.test.tsx
git commit -m "功能(IM客户端): 从消息通知进入对应会话"
```

### Task 10: 补齐配置文档、全链验证和安全检查

**Files:**
- Modify: `im-client/packages/app-mobile/README.md`
- Modify: `README.md`
- Modify: `deploy/.env.example`
- Test: `backend/src/test/java/com/rbac/im/push/delivery/PushLogRedactionTest.java`

**Interfaces:**
- Consumes: 前九个任务的完整功能
- Produces: 可复现的 Firebase 环境配置说明、最终验证记录

- [ ] **Step 1: 写日志脱敏和 Payload 边界失败测试**

```java
@Test
void failuresNeverRenderTargetOrPreview() {
    ListAppender<ILoggingEvent> logs = attachListAppender(PushDeliveryService.class);
    when(resolver.resolve(candidate)).thenReturn(List.of(
        targetWithValue("sensitive-target")));
    when(gateway.send(anyList())).thenReturn(List.of(
        new FcmSendResult(false, PushFailureKind.TRANSIENT, "UNAVAILABLE")));

    catchThrowable(() -> service.deliver(candidate));

    String log = logs.list.stream().map(ILoggingEvent::getFormattedMessage)
        .collect(joining("\n"));
    assertThat(log).contains("msg-1", "UNAVAILABLE")
        .doesNotContain("sensitive-target", "私密消息");
}
```

测试内的 `attachListAppender` 使用 Logback `LoggerContext` 创建并启动 `ListAppender<ILoggingEvent>`，挂到指定类 Logger；测试结束后在 `@AfterEach` 中 detach，避免污染其他测试。

- [ ] **Step 2: 运行边界测试并修正所有泄漏路径**

Run: `mvn -pl backend -Dtest=PushLogRedactionTest test`

Expected: PASS，失败输出不包含目标值或消息摘要。

- [ ] **Step 3: 写清本地与生产配置步骤**

README 必须记录：

1. 在 Firebase 创建 package ID 为 `com.appmobile` 的 Android 应用
2. 把环境对应的 `google-services.json` 放到 `android/app/`，文件保持忽略状态
3. 服务端通过 ADC 或工作负载身份获取凭证，不在仓库保存私钥
4. 设置 `IM_PUSH_ENABLED=true` 后启动后端
5. 使用带 Google Play 服务的模拟器或真机验证
6. 说明 Android 强行停止后无法保证收到普通 FCM

`deploy/.env.example` 只增加 `IM_PUSH_ENABLED=false`，不能增加私钥示例值。

- [ ] **Step 4: 运行后端完整编译与单元测试**

Run: `mvn -pl backend test`

Expected: PASS。需要 MySQL、MongoDB、Redis 或 Kafka 的既有集成测试若环境未启动，应按项目现有方式启动依赖后重跑，不能把它们改为跳过。

- [ ] **Step 5: 运行客户端完整质量检查**

Run: `cd im-client/packages/app-mobile && npm test -- --runInBand`

Run: `cd im-client/packages/app-mobile && npm run lint`

Run: `cd im-client/packages/app-mobile && npx tsc --noEmit`

Expected: 全部 PASS。

- [ ] **Step 6: 运行 Android 编译和原生单元测试**

Run: `cd im-client/packages/app-mobile/android && ./gradlew testDebugUnitTest assembleDebug`

Expected: 未提供 `google-services.json` 时仍能编译且推送显示为不可用；提供有效配置时 Firebase 初始化成功。

- [ ] **Step 7: 执行手工真机矩阵**

按设计文档逐项验证 Android 12 与 Android 13 及以上设备的权限允许/拒绝、前台、后台、锁屏、划掉进程、冷启动点击、免打扰、提及、多消息、多会话、多设备和账号切换。

每个失败案例记录 `msgId`、设备系统版本、App 状态、FCM 接收时间和粗粒度错误码，不记录 Payload 或 FCM 目标。

- [ ] **Step 8: 检查最终差异与凭证泄漏**

Run: `git diff --check`

Run: `git status --short`

Run: `git diff HEAD~9 | rg -n "private_key_id|BEGIN PRIVATE KEY|client_email"`

Expected: diff 无空白错误，工作区文件只属于本功能，九个已提交任务加当前任务的凭证搜索无输出。

- [ ] **Step 9: 提交文档和最终验证修正**

```bash
git add README.md deploy/.env.example \
  im-client/packages/app-mobile/README.md \
  backend/src/test/java/com/rbac/im/push/delivery/PushLogRedactionTest.java
git commit -m "文档(IM推送): 补充FCM配置与验收说明"
```

## 完成定义

完成全部任务后，使用以下清单核对设计覆盖：

- [ ] 服务端登记接口按认证用户幂等登记、重绑和禁用设备
- [ ] Kafka 候选事件只在消息落库与提及状态更新后发布
- [ ] 接收人规则正确处理发送者、免打扰和提及
- [ ] FCM 发送与消息主链隔离，具备有限重试、死信和低基数指标
- [ ] Android 原生层在 React 未启动时也能校验账号、去重和显示通知
- [ ] 前台只触发同步，不显示系统通知
- [ ] 通知点击在启动、认证和导航就绪后打开正确会话
- [ ] 退出与账号切换不会显示旧账号延迟通知
- [ ] 权限拒绝、Firebase 配置缺失和 FCM 故障不影响 IM 主功能
- [ ] 自动化测试、Android 编译、真机矩阵和凭证扫描全部完成
