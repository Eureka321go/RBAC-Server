# IM 群聊（里程碑 5）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 IM 后端上加群聊——群生命周期管理（建/加/踢/退/解散/改名/转让/设免管理员/禁言）+ 全生命周期 SYSTEM 消息，复用已有扇出/列表/拉取，并补上发送成员校验与群禁言拦截。

**Architecture:** 抽取共享写入组件 `MessageAppender`（定序+落库+更新会话摘要+扇出），用户消息与 SYSTEM 消息共用；新增 `GroupService` + `ImGroupController` 承载群管理，事务内保持 `im_group_member` 与 `im_conversation_member` 同步；发送校验落在 logic 层 `InboundMessageConsumer`。im-gateway 不改动。

**Tech Stack:** Java 21 + Spring Boot 3.4.1 + MyBatis-Plus 3.5.9 + MySQL 8.4 + MongoDB + Redis + Kafka；测试用 `@SpringBootTest @ActiveProfiles("test")`（连 `rbac_test`/`rbac_im`/Redis）。

## Global Constraints

- 统一响应 `com.rbac.common.Result<T>`；`Result.success(data)`。
- 统一异常 `com.rbac.common.exception.BusinessException(int code, String messageKey, Object... args)`，文案 key 走 i18n（`src/main/resources/i18n/messages*.properties`，precedent key：`im.conversation.notMember`）。
- 当前用户：`com.rbac.common.util.SecurityUtils.getUserId()` → `Long`。
- 控制器统一 `@RequestMapping("/im")`（context-path `/api` 前缀由框架加，最终 `/api/im/...`）。
- 枚举固定字符串：群角色 `OWNER`/`ADMIN`/`MEMBER`；会话类型 `SINGLE`/`GROUP`；消息 `type` 新增 `SYSTEM`。
- 逻辑删除：实体继承 `BaseEntity`（`@TableLogic deleted`），`mapper.delete*` 即软删。
- API camelCase；DB snake_case。
- 群 cid = `g_{groupId}`；单聊 cid = `c_{minId}_{maxId}`（已有）。
- 成员上限配置 `rbac.im.group-max-members`（默认 500）。
- im-gateway 模块**不改动**。

---

### Task 1: 抽取 `MessageAppender`（共享写入+扇出，修 `last_msg_seq` 缺口）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/MessageAppender.java`
- Modify: `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`
- Test: `backend/src/test/java/com/rbac/im/service/MessageAppenderTest.java`

**Interfaces:**
- Consumes: `SeqService.nextSeq(String cid) -> long`；`OutboundDispatcher.dispatch(String cid, Envelope push)`；`ImMessageRepository.save(ImMessage)`；`ImConversationMapper`（MyBatis-Plus BaseMapper）。
- Produces: `MessageAppender.append(String cid, Long senderId, String type, Map<String,Object> body, String clientMsgId) -> long`（返回 seq；落库 + 更新 `im_conversation.last_msg_seq/last_msg_preview` + 扇出）。`static String MessageAppender.preview(String type, Map<String,Object> body)`。

- [ ] **Step 1: 写失败测试**

创建 `MessageAppenderTest.java`：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.mapper.ImConversationMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class MessageAppenderTest {

    @Autowired MessageAppender appender;
    @Autowired ImMessageRepository repo;
    @Autowired ImConversationMapper conversationMapper;

    String cid = "c_9001_9002";

    @BeforeEach
    void clean() {
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(1000)));
        conversationMapper.delete(new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType("SINGLE"); c.setLastMsgSeq(0L);
        conversationMapper.insert(c);
    }

    @Test
    void append_saves_updatesSummary_returnsSeq() {
        long seq = appender.append(cid, 9001L, "TEXT", Map.of("text", "在吗"), "cm-1");

        List<ImMessage> rows = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10));
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getSeq()).isEqualTo(seq);
        assertThat(rows.get(0).getType()).isEqualTo("TEXT");

        ImConversation c = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        assertThat(c.getLastMsgSeq()).isEqualTo(seq);
        assertThat(c.getLastMsgPreview()).isEqualTo("在吗");
    }

    @Test
    void preview_forSystem_isPlaceholder() {
        assertThat(MessageAppender.preview("SYSTEM", Map.of("event", "MEMBER_JOIN"))).isEqualTo("[系统消息]");
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=MessageAppenderTest`
Expected: 编译失败——`MessageAppender` 不存在。

- [ ] **Step 3: 实现 `MessageAppender`**

创建 `MessageAppender.java`：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.protocol.Envelope;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

/** 统一消息写入：定序 + 落库 + 更新会话摘要 + 扇出。用户消息与 SYSTEM 消息共用。 */
@Service
public class MessageAppender {

    private final ImMessageRepository repo;
    private final SeqService seqService;
    private final OutboundDispatcher dispatcher;
    private final ImConversationMapper conversationMapper;

    public MessageAppender(ImMessageRepository repo,
                           SeqService seqService,
                           OutboundDispatcher dispatcher,
                           ImConversationMapper conversationMapper) {
        this.repo = repo;
        this.seqService = seqService;
        this.dispatcher = dispatcher;
        this.conversationMapper = conversationMapper;
    }

    /** 追加一条消息并扇出，返回定序后的 seq。 */
    public long append(String cid, Long senderId, String type, Map<String, Object> body, String clientMsgId) {
        long seq = seqService.nextSeq(cid);
        String msgId = UUID.randomUUID().toString().replace("-", "");
        long ts = System.currentTimeMillis();

        ImMessage m = new ImMessage();
        m.setCid(cid);
        m.setSeq(seq);
        m.setMsgId(msgId);
        m.setSenderId(senderId);
        m.setType(type);
        m.setBody(body);
        m.setClientMsgId(clientMsgId);
        m.setTs(ts);
        repo.save(m);

        updateSummary(cid, seq, preview(type, body));

        Envelope push = new Envelope();
        push.setOp("PUSH");
        push.setCid(cid);
        push.setSenderId(senderId);
        push.setType(type);
        push.setBody(body);
        push.setClientMsgId(clientMsgId);
        push.setSeq(seq);
        push.setMsgId(msgId);
        push.setTs(ts);
        dispatcher.dispatch(cid, push);

        return seq;
    }

    private void updateSummary(String cid, long seq, String preview) {
        ImConversation c = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        if (c != null) {
            c.setLastMsgSeq(seq);
            c.setLastMsgPreview(preview);
            conversationMapper.updateById(c);
        }
    }

    /** 会话列表用的摘要文案。 */
    static String preview(String type, Map<String, Object> body) {
        if ("TEXT".equals(type) && body != null && body.get("text") != null) {
            String t = String.valueOf(body.get("text"));
            return t.length() > 200 ? t.substring(0, 200) : t;
        }
        if ("SYSTEM".equals(type)) {
            return "[系统消息]";
        }
        return "[" + type + "]";
    }
}
```

- [ ] **Step 4: 重构 `InboundMessageConsumer` 改用 appender**

用以下内容替换 `InboundMessageConsumer.java`（去掉自建落库/扇出逻辑，改调 appender；保留幂等判重）：

```java
package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
public class InboundMessageConsumer {

    private final ImMessageRepository repo;
    private final MessageAppender appender;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundMessageConsumer(ImMessageRepository repo, MessageAppender appender) {
        this.repo = repo;
        this.appender = appender;
    }

    @KafkaListener(topics = ImKafkaTopics.IN, groupId = "im-logic")
    public void onMessage(String json) throws Exception {
        Envelope env = mapper.readValue(json, Envelope.class);

        // 幂等：同一发送者 + clientMsgId 只处理一次
        if (env.getClientMsgId() != null
                && repo.existsBySenderIdAndClientMsgId(env.getSenderId(), env.getClientMsgId())) {
            return;
        }

        appender.append(env.getCid(), env.getSenderId(), env.getType(), env.getBody(), env.getClientMsgId());
    }
}
```

> 注：现有 `InboundMessageConsumerTest` 若断言了 seq/落库，重构后仍应通过（行为不变，只是内部委托）。若该测试直接 mock 了 `SeqService`/`ConversationService`/`OutboundDispatcher` 构造参数，需同步更新其构造为 `new InboundMessageConsumer(repo, appender)`——Task 3 会进一步改此类构造，届时一并修正。本步只需保证编译与既有断言通过。

- [ ] **Step 5: 运行测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=MessageAppenderTest,InboundMessageConsumerTest`
Expected: PASS（若 `InboundMessageConsumerTest` 因构造签名变化编译失败，改其构造为 `new InboundMessageConsumer(repo, appender)` 并注入 `@Autowired MessageAppender`）。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/MessageAppender.java \
        backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java \
        backend/src/test/java/com/rbac/im/service/MessageAppenderTest.java \
        backend/src/test/java/com/rbac/im/service/InboundMessageConsumerTest.java
git commit -m "refactor(im): 抽取 MessageAppender 统一写入+扇出，修 last_msg_seq 缺口"
```

---

### Task 2: V4 迁移 + `ImGroupMember.muted` 字段

**Files:**
- Create: `backend/src/main/resources/db/migration/V4__im_group_member_muted.sql`
- Modify: `backend/src/main/java/com/rbac/im/entity/ImGroupMember.java`
- Test: `backend/src/test/java/com/rbac/im/mapper/ImGroupMemberMutedTest.java`

**Interfaces:**
- Produces: `ImGroupMember.getMuted()/setMuted(Integer)`（0/1，群级禁言）。

- [ ] **Step 1: 写失败测试**

创建 `ImGroupMemberMutedTest.java`：

```java
package com.rbac.im.mapper;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.entity.ImGroupMember;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class ImGroupMemberMutedTest {

    @Autowired ImGroupMemberMapper mapper;

    @Test
    void muted_roundTrip() {
        ImGroupMember m = new ImGroupMember();
        m.setGroupId(770001L);
        m.setUserId(880001L);
        m.setRole("MEMBER");
        m.setMuted(1);
        mapper.insert(m);

        ImGroupMember loaded = mapper.selectOne(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, 770001L)
                .eq(ImGroupMember::getUserId, 880001L));
        assertThat(loaded.getMuted()).isEqualTo(1);

        mapper.deleteById(loaded.getId());
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=ImGroupMemberMutedTest`
Expected: 编译失败——`setMuted` 不存在。

- [ ] **Step 3: 加迁移文件**

创建 `V4__im_group_member_muted.sql`：

```sql
ALTER TABLE `im_group_member`
    ADD COLUMN `muted` TINYINT NOT NULL DEFAULT 0 COMMENT '群级禁言：1=被管理员禁言，发送时拦截';
```

- [ ] **Step 4: 加实体字段**

修改 `ImGroupMember.java`，在 `role` 下加字段：

```java
    private String role;
    private Integer muted;
```

- [ ] **Step 5: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=ImGroupMemberMutedTest`
Expected: PASS（Flyway 自动应用 V4）。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/resources/db/migration/V4__im_group_member_muted.sql \
        backend/src/main/java/com/rbac/im/entity/ImGroupMember.java \
        backend/src/test/java/com/rbac/im/mapper/ImGroupMemberMutedTest.java
git commit -m "feat(im): 群成员加 muted 群级禁言字段（V4 迁移）"
```

---

### Task 3: 发送成员校验 + 群禁言拦截 + ERROR 回执

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/ConversationService.java`（加 `isGroupMuted` + `groupIdFromCid`，注入 `ImGroupMemberMapper`）
- Modify: `backend/src/main/java/com/rbac/im/service/OutboundDispatcher.java`（加 `dispatchToUser`）
- Modify: `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`（加校验 + `pushError`）
- Test: `backend/src/test/java/com/rbac/im/service/InboundSendCheckTest.java`

**Interfaces:**
- Consumes: `ConversationService.isMember(String cid, long userId) -> boolean`（已有）。
- Produces: `ConversationService.isGroupMuted(String cid, long userId) -> boolean`；`static Long ConversationService.groupIdFromCid(String cid)`；`OutboundDispatcher.dispatchToUser(long userId, Envelope env)`。

- [ ] **Step 1: 写失败测试**

创建 `InboundSendCheckTest.java`（用 `@MockBean OutboundDispatcher` 校验 ERROR 分支，并直接查 Mongo 确认丢弃）：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("test")
class InboundSendCheckTest {

    @Autowired InboundMessageConsumer consumer;
    @Autowired ImMessageRepository repo;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired ImConversationMemberMapper memberMapper;
    @MockBean OutboundDispatcher dispatcher;   // 拦截扇出，验证 ERROR 与丢弃

    final ObjectMapper om = new ObjectMapper();
    final String cid = "c_9101_9102";

    @BeforeEach
    void setup() {
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(1000)));
        conversationMapper.delete(new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        memberMapper.delete(new LambdaQueryWrapper<ImConversationMember>().eq(ImConversationMember::getCid, cid));
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType("SINGLE"); c.setLastMsgSeq(0L);
        conversationMapper.insert(c);
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid); m.setUserId(9101L); m.setLastReadSeq(0L); m.setMentionSeq(0L); m.setMuted(0);
        memberMapper.insert(m);
    }

    private String json(long sender) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND"); e.setCid(cid); e.setSenderId(sender);
        e.setType("TEXT"); e.setBody(Map.of("text", "hi")); e.setClientMsgId("cm-" + sender);
        return om.writeValueAsString(e);
    }

    @Test
    void nonMember_dropped_andErrorPushed() throws Exception {
        consumer.onMessage(json(9999L));   // 9999 非成员

        assertThat(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10))).isEmpty();
        verify(dispatcher).dispatchToUser(eq(9999L), argThat(env ->
                "ERROR".equals(env.getOp()) && "NOT_MEMBER".equals(env.getBody().get("reason"))));
        verify(dispatcher, never()).dispatch(any(), any());
    }

    @Test
    void member_proceeds() throws Exception {
        consumer.onMessage(json(9101L));   // 9101 是成员

        assertThat(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10))).hasSize(1);
        verify(dispatcher).dispatch(eq(cid), any());
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=InboundSendCheckTest`
Expected: FAIL——`dispatchToUser` 不存在 / 非成员消息未被丢弃。

- [ ] **Step 3: `OutboundDispatcher` 加 `dispatchToUser`**

在 `OutboundDispatcher.java` 的 `dispatch` 方法后追加：

```java
    /** 定向推送给单个用户的所有在线设备（用于发送失败 ERROR 回执）。 */
    public void dispatchToUser(long userId, Envelope env) {
        Map<Object, Object> routes = redis.opsForHash().entries("route:user:" + userId);
        for (Map.Entry<Object, Object> e : routes.entrySet()) {
            String deviceId = String.valueOf(e.getKey());
            String gatewayId = String.valueOf(e.getValue());
            OutboundPacket packet = new OutboundPacket();
            packet.setGatewayId(gatewayId);
            packet.setTargetUserId(userId);
            packet.setDeviceId(deviceId);
            packet.setEnvelope(env);
            send(gatewayId, packet);
        }
    }
```

- [ ] **Step 4: `ConversationService` 加禁言查询与 cid 解析**

在 `ConversationService.java`：注入 `ImGroupMemberMapper`，并加两个方法。改构造与字段：

```java
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImGroupMemberMapper;
```

```java
    private final ImConversationMapper conversationMapper;
    private final ImConversationMemberMapper memberMapper;
    private final ImGroupMemberMapper groupMemberMapper;

    public ConversationService(ImConversationMapper conversationMapper,
                               ImConversationMemberMapper memberMapper,
                               ImGroupMemberMapper groupMemberMapper) {
        this.conversationMapper = conversationMapper;
        this.memberMapper = memberMapper;
        this.groupMemberMapper = groupMemberMapper;
    }
```

在类内追加：

```java
    /** 从 cid 解析群 id；非群会话返回 null。 */
    public static Long groupIdFromCid(String cid) {
        return cid != null && cid.startsWith("g_") ? Long.valueOf(cid.substring(2)) : null;
    }

    /** 该用户在群会话内是否被禁言（单聊恒 false）。 */
    public boolean isGroupMuted(String cid, long userId) {
        Long gid = groupIdFromCid(cid);
        if (gid == null) {
            return false;
        }
        Long n = groupMemberMapper.selectCount(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, gid)
                .eq(ImGroupMember::getUserId, userId)
                .eq(ImGroupMember::getMuted, 1));
        return n != null && n > 0;
    }
```

- [ ] **Step 5: `InboundMessageConsumer` 加校验 + `pushError`**

用以下内容替换 `InboundMessageConsumer.java`：

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
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundMessageConsumer(ImMessageRepository repo,
                                  MessageAppender appender,
                                  ConversationService conversationService,
                                  OutboundDispatcher dispatcher) {
        this.repo = repo;
        this.appender = appender;
        this.conversationService = conversationService;
        this.dispatcher = dispatcher;
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

- [ ] **Step 6: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=InboundSendCheckTest,MessageAppenderTest,ConversationServiceTest`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/ConversationService.java \
        backend/src/main/java/com/rbac/im/service/OutboundDispatcher.java \
        backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java \
        backend/src/test/java/com/rbac/im/service/InboundSendCheckTest.java
git commit -m "feat(im): 发送成员校验+群禁言拦截，被拒回 ERROR 帧"
```

---

### Task 4: 建群闭环（`GroupService.createGroup` + `POST /api/im/groups`）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/ConversationService.java`（加 `ensureGroupConversation`、`addConversationMember`、`removeConversationMember`、`removeConversation`）
- Create: `backend/src/main/java/com/rbac/im/service/GroupService.java`
- Create: `backend/src/main/java/com/rbac/im/vo/CreateGroupResult.java`
- Create: `backend/src/main/java/com/rbac/im/dto/CreateGroupRequest.java`
- Create: `backend/src/main/java/com/rbac/im/controller/ImGroupController.java`
- Modify: `backend/src/main/resources/i18n/messages.properties` 及同目录其它 `messages_*.properties`
- Test: `backend/src/test/java/com/rbac/im/service/GroupServiceCreateTest.java`

**Interfaces:**
- Consumes: `MessageAppender.append(...)`；`ConversationService.groupIdFromCid`。
- Produces:
  - `ConversationService.ensureGroupConversation(long groupId, List<Long> memberIds) -> String cid`
  - `ConversationService.addConversationMember(String cid, long userId)`（`last_read_seq` 初始化为会话当前 `last_msg_seq`）
  - `ConversationService.removeConversationMember(String cid, long userId)`
  - `ConversationService.removeConversation(String cid)`
  - `GroupService.createGroup(long ownerId, String name, List<Long> memberIds) -> CreateGroupResult`
  - `CreateGroupResult{ Long groupId; String cid; }`
  - 私有约定：`GroupService.postSystem(String cid, long operatorId, String event, List<Long> targetIds, Map<String,Object> extra)`；`requireMember/requireManage/requireOwner`。

- [ ] **Step 1: 写失败测试**

创建 `GroupServiceCreateTest.java`：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class GroupServiceCreateTest {

    @Autowired GroupService groupService;
    @Autowired ImGroupMemberMapper groupMemberMapper;
    @Autowired ImConversationMemberMapper convMemberMapper;
    @Autowired ImMessageRepository repo;

    @Test
    void createGroup_setsOwner_insertsBothTables_emitsSystem() {
        CreateGroupResult r = groupService.createGroup(1001L, "测试群", List.of(1002L, 1003L));

        assertThat(r.getCid()).isEqualTo("g_" + r.getGroupId());

        List<ImGroupMember> gms = groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()));
        assertThat(gms).hasSize(3);
        assertThat(gms).anyMatch(m -> m.getUserId() == 1001L && "OWNER".equals(m.getRole()));
        assertThat(gms).filteredOn(m -> m.getUserId() != 1001L).allMatch(m -> "MEMBER".equals(m.getRole()));

        List<ImConversationMember> cms = convMemberMapper.selectList(new LambdaQueryWrapper<ImConversationMember>()
                .eq(ImConversationMember::getCid, r.getCid()));
        assertThat(cms).hasSize(3);

        List<ImMessage> msgs = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(r.getCid(), 0L, Limit.of(10));
        assertThat(msgs).hasSize(1);
        assertThat(msgs.get(0).getType()).isEqualTo("SYSTEM");
        assertThat(msgs.get(0).getBody().get("event")).isEqualTo("GROUP_CREATE");
    }

    @Test
    void createGroup_dedupesOwnerInMemberIds() {
        CreateGroupResult r = groupService.createGroup(2001L, "去重群", List.of(2001L, 2002L, 2002L));
        List<ImGroupMember> gms = groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()));
        assertThat(gms).hasSize(2);   // 2001(owner) + 2002
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceCreateTest`
Expected: 编译失败——`GroupService`/`CreateGroupResult` 不存在。

- [ ] **Step 3: `ConversationService` 加群会话/成员方法**

在 `ConversationService.java` 追加：

```java
    /** 建群会话（幂等）：插入 GROUP 会话 + 各成员会话位点行，返回 cid。 */
    @Transactional
    public String ensureGroupConversation(long groupId, java.util.List<Long> memberIds) {
        String cid = "g_" + groupId;
        ImConversation existing = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        if (existing == null) {
            ImConversation c = new ImConversation();
            c.setCid(cid);
            c.setType("GROUP");
            c.setGroupId(groupId);
            c.setLastMsgSeq(0L);
            conversationMapper.insert(c);
            for (Long uid : memberIds) {
                insertMember(cid, uid);
            }
        }
        return cid;
    }

    /** 加会话成员，last_read_seq 初始化为会话当前 last_msg_seq（新成员不背历史未读）。 */
    public void addConversationMember(String cid, long userId) {
        ImConversation c = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        long init = (c == null || c.getLastMsgSeq() == null) ? 0L : c.getLastMsgSeq();
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid);
        m.setUserId(userId);
        m.setLastReadSeq(init);
        m.setMentionSeq(0L);
        m.setMuted(0);
        memberMapper.insert(m);
    }

    public void removeConversationMember(String cid, long userId) {
        memberMapper.delete(new LambdaQueryWrapper<ImConversationMember>()
                .eq(ImConversationMember::getCid, cid)
                .eq(ImConversationMember::getUserId, userId));
    }

    public void removeConversation(String cid) {
        memberMapper.delete(new LambdaQueryWrapper<ImConversationMember>()
                .eq(ImConversationMember::getCid, cid));
        conversationMapper.delete(new LambdaQueryWrapper<ImConversation>()
                .eq(ImConversation::getCid, cid));
    }
```

> `insertMember` 已是私有方法（`last_read_seq=0`），群会话建群时各成员从 0 起（此时会话 seq 尚为 0，等价）。

- [ ] **Step 4: 建 `CreateGroupResult` + `CreateGroupRequest`**

`vo/CreateGroupResult.java`：

```java
package com.rbac.im.vo;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class CreateGroupResult {
    private Long groupId;
    private String cid;
}
```

`dto/CreateGroupRequest.java`：

```java
package com.rbac.im.dto;

import lombok.Data;
import java.util.List;

@Data
public class CreateGroupRequest {
    private String name;
    private List<Long> memberIds;
}
```

- [ ] **Step 5: 建 `GroupService`（含建群 + 共享私有助手）**

创建 `GroupService.java`：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImGroup;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImGroupMapper;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/** 群生命周期管理：建/加/踢/退/解散/改名/转让/设免管理员/禁言，并发 SYSTEM 消息。 */
@Service
public class GroupService {

    private final ImGroupMapper groupMapper;
    private final ImGroupMemberMapper groupMemberMapper;
    private final ConversationService conversationService;
    private final MessageAppender appender;

    @Value("${rbac.im.group-max-members:500}")
    private int maxMembers;

    public GroupService(ImGroupMapper groupMapper,
                        ImGroupMemberMapper groupMemberMapper,
                        ConversationService conversationService,
                        MessageAppender appender) {
        this.groupMapper = groupMapper;
        this.groupMemberMapper = groupMemberMapper;
        this.conversationService = conversationService;
        this.appender = appender;
    }

    @Transactional
    public CreateGroupResult createGroup(long ownerId, String name, List<Long> memberIds) {
        ImGroup g = new ImGroup();
        g.setName(name);
        g.setOwnerId(ownerId);
        groupMapper.insert(g);
        long groupId = g.getId();

        LinkedHashSet<Long> all = new LinkedHashSet<>();
        all.add(ownerId);
        if (memberIds != null) {
            all.addAll(memberIds);
        }

        String cid = conversationService.ensureGroupConversation(groupId, new ArrayList<>(all));
        for (Long uid : all) {
            insertGroupMember(groupId, uid, uid == ownerId ? "OWNER" : "MEMBER");
        }
        postSystem(cid, ownerId, "GROUP_CREATE", new ArrayList<>(all), Map.of("name", name));
        return new CreateGroupResult(groupId, cid);
    }

    // ---------- 共享私有助手（后续 Task 复用） ----------

    void insertGroupMember(long groupId, long userId, String role) {
        ImGroupMember m = new ImGroupMember();
        m.setGroupId(groupId);
        m.setUserId(userId);
        m.setRole(role);
        m.setMuted(0);
        groupMemberMapper.insert(m);
    }

    ImGroupMember requireMember(long groupId, long userId) {
        ImGroupMember m = groupMemberMapper.selectOne(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, groupId)
                .eq(ImGroupMember::getUserId, userId));
        if (m == null) {
            throw new BusinessException(403, "im.group.notMember");
        }
        return m;
    }

    void requireManage(ImGroupMember op) {
        if (!"OWNER".equals(op.getRole()) && !"ADMIN".equals(op.getRole())) {
            throw new BusinessException(403, "im.group.noPermission");
        }
    }

    void requireOwner(ImGroupMember op) {
        if (!"OWNER".equals(op.getRole())) {
            throw new BusinessException(403, "im.group.ownerOnly");
        }
    }

    boolean isGroupMember(long groupId, long userId) {
        Long n = groupMemberMapper.selectCount(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, groupId)
                .eq(ImGroupMember::getUserId, userId));
        return n != null && n > 0;
    }

    long memberCount(long groupId) {
        Long n = groupMemberMapper.selectCount(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, groupId));
        return n == null ? 0L : n;
    }

    void postSystem(String cid, long operatorId, String event, List<Long> targetIds, Map<String, Object> extra) {
        Map<String, Object> body = new HashMap<>();
        body.put("event", event);
        body.put("operatorId", operatorId);
        if (targetIds != null) {
            body.put("targetIds", targetIds);
        }
        if (extra != null) {
            body.put("extra", extra);
        }
        appender.append(cid, operatorId, "SYSTEM", body, null);
    }
}
```

- [ ] **Step 6: 建 `ImGroupController`（先只挂建群接口）**

创建 `ImGroupController.java`：

```java
package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.dto.CreateGroupRequest;
import com.rbac.im.service.GroupService;
import com.rbac.im.vo.CreateGroupResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** IM 群管理。 */
@RestController
@RequestMapping("/im/groups")
public class ImGroupController {

    private final GroupService groupService;

    public ImGroupController(GroupService groupService) {
        this.groupService = groupService;
    }

    @PostMapping
    public Result<CreateGroupResult> create(@RequestBody CreateGroupRequest req) {
        return Result.success(groupService.createGroup(SecurityUtils.getUserId(), req.getName(), req.getMemberIds()));
    }
}
```

- [ ] **Step 7: 加 i18n 文案**

在 `src/main/resources/i18n/messages.properties`（`im.conversation.notMember` 所在文件）追加（并在同目录每个 `messages_*.properties` 加对应翻译）：

```properties
im.group.notMember=你不是该群成员
im.group.noPermission=需要群主或管理员权限
im.group.ownerOnly=仅群主可操作
im.group.notFound=群不存在
im.group.memberLimit=群成员数已达上限
im.group.cannotKickSelf=不能移除自己，请使用退群
im.group.cannotKickOwner=不能移除群主
im.group.adminKickMemberOnly=管理员只能移除普通成员
im.group.ownerCannotLeave=群主须先转让或解散群
im.group.invalidRole=非法的角色变更
im.group.muteMemberOnly=只能禁言普通成员
```

- [ ] **Step 8: 加配置项**

在 `backend/src/main/resources/application.yml` 的 `rbac:` 节点下加（若无 `im:` 子节点则新增）：

```yaml
rbac:
  im:
    group-max-members: 500
```

- [ ] **Step 9: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceCreateTest`
Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/GroupService.java \
        backend/src/main/java/com/rbac/im/service/ConversationService.java \
        backend/src/main/java/com/rbac/im/vo/CreateGroupResult.java \
        backend/src/main/java/com/rbac/im/dto/CreateGroupRequest.java \
        backend/src/main/java/com/rbac/im/controller/ImGroupController.java \
        backend/src/main/resources/i18n/ backend/src/main/resources/application.yml \
        backend/src/test/java/com/rbac/im/service/GroupServiceCreateTest.java
git commit -m "feat(im): 建群闭环（GroupService.createGroup + POST /api/im/groups）"
```

---

### Task 5: 加成员 + 成员上限（`GroupService.addMembers` + `POST /members`）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/GroupService.java`
- Create: `backend/src/main/java/com/rbac/im/dto/AddMembersRequest.java`
- Modify: `backend/src/main/java/com/rbac/im/controller/ImGroupController.java`
- Test: `backend/src/test/java/com/rbac/im/service/GroupServiceAddMemberTest.java`

**Interfaces:**
- Produces: `GroupService.addMembers(long operatorId, long groupId, List<Long> userIds)`；`AddMembersRequest{ List<Long> userIds; }`。

- [ ] **Step 1: 写失败测试**

创建 `GroupServiceAddMemberTest.java`（用 `@SpringBootTest(properties = "rbac.im.group-max-members=3")` 便于测上限）：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties = "rbac.im.group-max-members=3")
@ActiveProfiles("test")
class GroupServiceAddMemberTest {

    @Autowired GroupService groupService;
    @Autowired ImGroupMemberMapper groupMemberMapper;
    @Autowired ImConversationMemberMapper convMemberMapper;

    @Test
    void owner_addMember_insertsBothTables() {
        CreateGroupResult r = groupService.createGroup(3001L, "群", List.of(3002L)); // 2 人
        groupService.addMembers(3001L, r.getGroupId(), List.of(3003L));

        assertThat(groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()))).hasSize(3);
        assertThat(convMemberMapper.selectList(new LambdaQueryWrapper<ImConversationMember>()
                .eq(ImConversationMember::getCid, r.getCid()))).hasSize(3);
    }

    @Test
    void member_cannotAdd() {
        CreateGroupResult r = groupService.createGroup(3101L, "群", List.of(3102L));
        assertThatThrownBy(() -> groupService.addMembers(3102L, r.getGroupId(), List.of(3103L)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("code", 403);
    }

    @Test
    void duplicateAdd_isIdempotent() {
        CreateGroupResult r = groupService.createGroup(3201L, "群", List.of(3202L));
        groupService.addMembers(3201L, r.getGroupId(), List.of(3202L, 3203L)); // 3202 已在群
        assertThat(groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()))).hasSize(3);
    }

    @Test
    void overLimit_rejected() {
        CreateGroupResult r = groupService.createGroup(3301L, "群", List.of(3302L, 3303L)); // 3 人=上限
        assertThatThrownBy(() -> groupService.addMembers(3301L, r.getGroupId(), List.of(3304L)))
                .isInstanceOf(BusinessException.class);
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceAddMemberTest`
Expected: 编译失败——`addMembers` 不存在。

- [ ] **Step 3: 实现 `addMembers`**

在 `GroupService.java` 追加：

```java
    @Transactional
    public void addMembers(long operatorId, long groupId, List<Long> userIds) {
        ImGroupMember op = requireMember(groupId, operatorId);
        requireManage(op);
        String cid = "g_" + groupId;

        long current = memberCount(groupId);
        List<Long> added = new ArrayList<>();
        LinkedHashSet<Long> distinct = new LinkedHashSet<>(userIds == null ? List.of() : userIds);
        for (Long uid : distinct) {
            if (isGroupMember(groupId, uid)) {
                continue;   // 幂等
            }
            if (current + added.size() >= maxMembers) {
                throw new BusinessException(400, "im.group.memberLimit");
            }
            insertGroupMember(groupId, uid, "MEMBER");
            conversationService.addConversationMember(cid, uid);
            added.add(uid);
        }
        if (!added.isEmpty()) {
            postSystem(cid, operatorId, "MEMBER_JOIN", added, null);
        }
    }
```

- [ ] **Step 4: `AddMembersRequest` + 控制器接口**

`dto/AddMembersRequest.java`：

```java
package com.rbac.im.dto;

import lombok.Data;
import java.util.List;

@Data
public class AddMembersRequest {
    private List<Long> userIds;
}
```

在 `ImGroupController.java` 追加（补 import `PathVariable`）：

```java
    @PostMapping("/{groupId}/members")
    public Result<Void> addMembers(@PathVariable Long groupId, @RequestBody AddMembersRequest req) {
        groupService.addMembers(SecurityUtils.getUserId(), groupId, req.getUserIds());
        return Result.success();
    }
```

- [ ] **Step 5: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceAddMemberTest`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/GroupService.java \
        backend/src/main/java/com/rbac/im/dto/AddMembersRequest.java \
        backend/src/main/java/com/rbac/im/controller/ImGroupController.java \
        backend/src/test/java/com/rbac/im/service/GroupServiceAddMemberTest.java
git commit -m "feat(im): 群加成员+成员上限（POST /members）"
```

---

### Task 6: 踢人 + 退群（`removeMember` / `leaveGroup`）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/GroupService.java`
- Modify: `backend/src/main/java/com/rbac/im/controller/ImGroupController.java`
- Test: `backend/src/test/java/com/rbac/im/service/GroupServiceRemoveTest.java`

**Interfaces:**
- Produces: `GroupService.removeMember(long operatorId, long groupId, long targetId)`；`GroupService.leaveGroup(long userId, long groupId)`。

- [ ] **Step 1: 写失败测试**

创建 `GroupServiceRemoveTest.java`：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class GroupServiceRemoveTest {

    @Autowired GroupService groupService;
    @Autowired ImGroupMemberMapper gmMapper;

    private long count(long groupId) {
        return gmMapper.selectCount(new LambdaQueryWrapper<ImGroupMember>().eq(ImGroupMember::getGroupId, groupId));
    }

    @Test
    void owner_kicksMember() {
        CreateGroupResult r = groupService.createGroup(4001L, "群", List.of(4002L, 4003L));
        groupService.removeMember(4001L, r.getGroupId(), 4002L);
        assertThat(count(r.getGroupId())).isEqualTo(2);
    }

    @Test
    void cannotKickOwner() {
        CreateGroupResult r = groupService.createGroup(4101L, "群", List.of(4102L));
        assertThatThrownBy(() -> groupService.removeMember(4102L, r.getGroupId(), 4101L))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void adminKicksMemberOnly() {
        CreateGroupResult r = groupService.createGroup(4201L, "群", List.of(4202L, 4203L));
        groupService.setRole(4201L, r.getGroupId(), 4202L, "ADMIN"); // 依赖 Task 7；若尚未实现，本用例可后置
        // admin 4202 试踢另一个 admin：先把 4203 也设为 admin
        groupService.setRole(4201L, r.getGroupId(), 4203L, "ADMIN");
        assertThatThrownBy(() -> groupService.removeMember(4202L, r.getGroupId(), 4203L))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void memberLeaves() {
        CreateGroupResult r = groupService.createGroup(4301L, "群", List.of(4302L));
        groupService.leaveGroup(4302L, r.getGroupId());
        assertThat(count(r.getGroupId())).isEqualTo(1);
    }

    @Test
    void ownerCannotLeave() {
        CreateGroupResult r = groupService.createGroup(4401L, "群", List.of(4402L));
        assertThatThrownBy(() -> groupService.leaveGroup(4401L, r.getGroupId()))
                .isInstanceOf(BusinessException.class);
    }
}
```

> `adminKicksMemberOnly` 用例依赖 Task 7 的 `setRole`。若严格按序执行、Task 7 尚未落地，先在本任务实现 `removeMember/leaveGroup`，把该用例标 `@Disabled("待 Task 7 setRole")`，Task 7 完成后移除注解。其余 4 个用例本任务即可全绿。

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceRemoveTest`
Expected: 编译失败——`removeMember`/`leaveGroup` 不存在。

- [ ] **Step 3: 实现 `removeMember` / `leaveGroup`**

在 `GroupService.java` 追加：

```java
    @Transactional
    public void removeMember(long operatorId, long groupId, long targetId) {
        if (operatorId == targetId) {
            throw new BusinessException(400, "im.group.cannotKickSelf");
        }
        ImGroupMember op = requireMember(groupId, operatorId);
        requireManage(op);
        ImGroupMember target = requireMember(groupId, targetId);
        if ("OWNER".equals(target.getRole())) {
            throw new BusinessException(403, "im.group.cannotKickOwner");
        }
        if ("ADMIN".equals(op.getRole()) && !"MEMBER".equals(target.getRole())) {
            throw new BusinessException(403, "im.group.adminKickMemberOnly");
        }
        String cid = "g_" + groupId;
        groupMemberMapper.deleteById(target.getId());
        conversationService.removeConversationMember(cid, targetId);
        postSystem(cid, operatorId, "MEMBER_KICK", List.of(targetId), null);
    }

    @Transactional
    public void leaveGroup(long userId, long groupId) {
        ImGroupMember m = requireMember(groupId, userId);
        if ("OWNER".equals(m.getRole())) {
            throw new BusinessException(403, "im.group.ownerCannotLeave");
        }
        String cid = "g_" + groupId;
        groupMemberMapper.deleteById(m.getId());
        conversationService.removeConversationMember(cid, userId);
        postSystem(cid, userId, "MEMBER_LEAVE", List.of(userId), null);
    }
```

- [ ] **Step 4: 控制器接口**

在 `ImGroupController.java` 追加（补 import `DeleteMapping`）：

```java
    @DeleteMapping("/{groupId}/members/me")
    public Result<Void> leave(@PathVariable Long groupId) {
        groupService.leaveGroup(SecurityUtils.getUserId(), groupId);
        return Result.success();
    }

    @DeleteMapping("/{groupId}/members/{userId}")
    public Result<Void> kick(@PathVariable Long groupId, @PathVariable Long userId) {
        groupService.removeMember(SecurityUtils.getUserId(), groupId, userId);
        return Result.success();
    }
```

> 注意路由顺序：`/members/me` 须先于 `/members/{userId}`，避免 `me` 被当作 `{userId}`。Spring 精确匹配优先，但仍按此顺序声明以求清晰。

- [ ] **Step 5: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceRemoveTest`
Expected: PASS（`adminKicksMemberOnly` 若已 `@Disabled` 则跳过）。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/GroupService.java \
        backend/src/main/java/com/rbac/im/controller/ImGroupController.java \
        backend/src/test/java/com/rbac/im/service/GroupServiceRemoveTest.java
git commit -m "feat(im): 群踢人+退群（DELETE /members/{id} 与 /members/me）"
```

---

### Task 7: 改名 + 转让群主 + 设免管理员

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/GroupService.java`
- Create: `backend/src/main/java/com/rbac/im/dto/RenameRequest.java`, `TransferRequest.java`, `SetRoleRequest.java`
- Modify: `backend/src/main/java/com/rbac/im/controller/ImGroupController.java`
- Test: `backend/src/test/java/com/rbac/im/service/GroupServiceAdminTest.java`

**Interfaces:**
- Produces:
  - `GroupService.rename(long operatorId, long groupId, String name)`
  - `GroupService.transferOwner(long operatorId, long groupId, long newOwnerId)`
  - `GroupService.setRole(long operatorId, long groupId, long targetId, String role)`

- [ ] **Step 1: 写失败测试**

创建 `GroupServiceAdminTest.java`：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImGroup;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImGroupMapper;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class GroupServiceAdminTest {

    @Autowired GroupService groupService;
    @Autowired ImGroupMapper groupMapper;
    @Autowired ImGroupMemberMapper gmMapper;

    private String roleOf(long groupId, long userId) {
        return gmMapper.selectOne(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, groupId).eq(ImGroupMember::getUserId, userId)).getRole();
    }

    @Test
    void ownerRenames() {
        CreateGroupResult r = groupService.createGroup(5001L, "旧名", List.of(5002L));
        groupService.rename(5001L, r.getGroupId(), "新名");
        assertThat(groupMapper.selectById(r.getGroupId()).getName()).isEqualTo("新名");
    }

    @Test
    void memberCannotRename() {
        CreateGroupResult r = groupService.createGroup(5101L, "群", List.of(5102L));
        assertThatThrownBy(() -> groupService.rename(5102L, r.getGroupId(), "x"))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void transferOwner_swapsRoles() {
        CreateGroupResult r = groupService.createGroup(5201L, "群", List.of(5202L));
        groupService.transferOwner(5201L, r.getGroupId(), 5202L);
        assertThat(roleOf(r.getGroupId(), 5202L)).isEqualTo("OWNER");
        assertThat(roleOf(r.getGroupId(), 5201L)).isEqualTo("MEMBER");
        assertThat(groupMapper.selectById(r.getGroupId()).getOwnerId()).isEqualTo(5202L);
    }

    @Test
    void ownerSetsAdmin() {
        CreateGroupResult r = groupService.createGroup(5301L, "群", List.of(5302L));
        groupService.setRole(5301L, r.getGroupId(), 5302L, "ADMIN");
        assertThat(roleOf(r.getGroupId(), 5302L)).isEqualTo("ADMIN");
        groupService.setRole(5301L, r.getGroupId(), 5302L, "MEMBER");
        assertThat(roleOf(r.getGroupId(), 5302L)).isEqualTo("MEMBER");
    }

    @Test
    void nonOwnerCannotSetRole() {
        CreateGroupResult r = groupService.createGroup(5401L, "群", List.of(5402L, 5403L));
        assertThatThrownBy(() -> groupService.setRole(5402L, r.getGroupId(), 5403L, "ADMIN"))
                .isInstanceOf(BusinessException.class);
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceAdminTest`
Expected: 编译失败——方法不存在。

- [ ] **Step 3: 实现三方法**

在 `GroupService.java` 追加（需 import `com.rbac.im.entity.ImGroup`）：

```java
    @Transactional
    public void rename(long operatorId, long groupId, String name) {
        ImGroupMember op = requireMember(groupId, operatorId);
        requireManage(op);
        ImGroup g = groupMapper.selectById(groupId);
        if (g == null) {
            throw new BusinessException(404, "im.group.notFound");
        }
        String oldName = g.getName();
        g.setName(name);
        groupMapper.updateById(g);
        postSystem("g_" + groupId, operatorId, "GROUP_RENAME", null, Map.of("oldName", oldName, "newName", name));
    }

    @Transactional
    public void transferOwner(long operatorId, long groupId, long newOwnerId) {
        ImGroupMember op = requireMember(groupId, operatorId);
        requireOwner(op);
        ImGroupMember target = requireMember(groupId, newOwnerId);
        op.setRole("MEMBER");
        groupMemberMapper.updateById(op);
        target.setRole("OWNER");
        groupMemberMapper.updateById(target);
        ImGroup g = groupMapper.selectById(groupId);
        g.setOwnerId(newOwnerId);
        groupMapper.updateById(g);
        postSystem("g_" + groupId, operatorId, "OWNER_TRANSFER", List.of(newOwnerId), null);
    }

    @Transactional
    public void setRole(long operatorId, long groupId, long targetId, String role) {
        if (!"ADMIN".equals(role) && !"MEMBER".equals(role)) {
            throw new BusinessException(400, "im.group.invalidRole");
        }
        ImGroupMember op = requireMember(groupId, operatorId);
        requireOwner(op);
        ImGroupMember target = requireMember(groupId, targetId);
        if ("OWNER".equals(target.getRole())) {
            throw new BusinessException(400, "im.group.invalidRole");
        }
        target.setRole(role);
        groupMemberMapper.updateById(target);
        postSystem("g_" + groupId, operatorId, "ADMIN_CHANGE", List.of(targetId), Map.of("role", role));
    }
```

- [ ] **Step 4: DTO + 控制器接口**

创建 `dto/RenameRequest.java`、`dto/TransferRequest.java`、`dto/SetRoleRequest.java`：

```java
package com.rbac.im.dto;
import lombok.Data;
@Data public class RenameRequest { private String name; }
```
```java
package com.rbac.im.dto;
import lombok.Data;
@Data public class TransferRequest { private Long newOwnerId; }
```
```java
package com.rbac.im.dto;
import lombok.Data;
@Data public class SetRoleRequest { private String role; }
```

在 `ImGroupController.java` 追加（补 import `PatchMapping`、`PutMapping`）：

```java
    @PatchMapping("/{groupId}")
    public Result<Void> rename(@PathVariable Long groupId, @RequestBody RenameRequest req) {
        groupService.rename(SecurityUtils.getUserId(), groupId, req.getName());
        return Result.success();
    }

    @PostMapping("/{groupId}/owner")
    public Result<Void> transfer(@PathVariable Long groupId, @RequestBody TransferRequest req) {
        groupService.transferOwner(SecurityUtils.getUserId(), groupId, req.getNewOwnerId());
        return Result.success();
    }

    @PutMapping("/{groupId}/members/{userId}/role")
    public Result<Void> setRole(@PathVariable Long groupId, @PathVariable Long userId, @RequestBody SetRoleRequest req) {
        groupService.setRole(SecurityUtils.getUserId(), groupId, userId, req.getRole());
        return Result.success();
    }
```

- [ ] **Step 5: 运行确认通过 + 解禁 Task 6 用例**

若 Task 6 的 `adminKicksMemberOnly` 曾标 `@Disabled`，现移除注解。

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceAdminTest,GroupServiceRemoveTest`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/GroupService.java \
        backend/src/main/java/com/rbac/im/dto/RenameRequest.java \
        backend/src/main/java/com/rbac/im/dto/TransferRequest.java \
        backend/src/main/java/com/rbac/im/dto/SetRoleRequest.java \
        backend/src/main/java/com/rbac/im/controller/ImGroupController.java \
        backend/src/test/java/com/rbac/im/service/GroupServiceAdminTest.java \
        backend/src/test/java/com/rbac/im/service/GroupServiceRemoveTest.java
git commit -m "feat(im): 群改名+转让群主+设免管理员"
```

---

### Task 8: 禁言/解禁成员（`setMute`）+ 端到端拦截验证

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/GroupService.java`
- Create: `backend/src/main/java/com/rbac/im/dto/SetMuteRequest.java`
- Modify: `backend/src/main/java/com/rbac/im/controller/ImGroupController.java`
- Test: `backend/src/test/java/com/rbac/im/service/GroupServiceMuteTest.java`

**Interfaces:**
- Consumes: `ConversationService.isGroupMuted`（Task 3）。
- Produces: `GroupService.setMute(long operatorId, long groupId, long targetId, boolean muted)`。

- [ ] **Step 1: 写失败测试**

创建 `GroupServiceMuteTest.java`（验证 `setMute` 落库 + `isGroupMuted` 生效）：

```java
package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class GroupServiceMuteTest {

    @Autowired GroupService groupService;
    @Autowired ConversationService conversationService;

    @Test
    void ownerMutesMember_thenUnmute() {
        CreateGroupResult r = groupService.createGroup(6001L, "群", List.of(6002L));
        groupService.setMute(6001L, r.getGroupId(), 6002L, true);
        assertThat(conversationService.isGroupMuted(r.getCid(), 6002L)).isTrue();

        groupService.setMute(6001L, r.getGroupId(), 6002L, false);
        assertThat(conversationService.isGroupMuted(r.getCid(), 6002L)).isFalse();
    }

    @Test
    void memberCannotMute() {
        CreateGroupResult r = groupService.createGroup(6101L, "群", List.of(6102L, 6103L));
        assertThatThrownBy(() -> groupService.setMute(6102L, r.getGroupId(), 6103L, true))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void cannotMuteAdminOrOwner() {
        CreateGroupResult r = groupService.createGroup(6201L, "群", List.of(6202L));
        groupService.setRole(6201L, r.getGroupId(), 6202L, "ADMIN");
        assertThatThrownBy(() -> groupService.setMute(6201L, r.getGroupId(), 6202L, true))
                .isInstanceOf(BusinessException.class);
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceMuteTest`
Expected: 编译失败——`setMute` 不存在。

- [ ] **Step 3: 实现 `setMute`**

在 `GroupService.java` 追加：

```java
    @Transactional
    public void setMute(long operatorId, long groupId, long targetId, boolean muted) {
        ImGroupMember op = requireMember(groupId, operatorId);
        requireManage(op);
        ImGroupMember target = requireMember(groupId, targetId);
        if (!"MEMBER".equals(target.getRole())) {
            throw new BusinessException(403, "im.group.muteMemberOnly");
        }
        target.setMuted(muted ? 1 : 0);
        groupMemberMapper.updateById(target);
        postSystem("g_" + groupId, operatorId, "MEMBER_MUTE", List.of(targetId), Map.of("muted", muted));
    }
```

- [ ] **Step 4: DTO + 控制器接口**

`dto/SetMuteRequest.java`：

```java
package com.rbac.im.dto;
import lombok.Data;
@Data public class SetMuteRequest { private Boolean muted; }
```

在 `ImGroupController.java` 追加：

```java
    @PutMapping("/{groupId}/members/{userId}/mute")
    public Result<Void> setMute(@PathVariable Long groupId, @PathVariable Long userId, @RequestBody SetMuteRequest req) {
        groupService.setMute(SecurityUtils.getUserId(), groupId, userId, Boolean.TRUE.equals(req.getMuted()));
        return Result.success();
    }
```

- [ ] **Step 5: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceMuteTest`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/GroupService.java \
        backend/src/main/java/com/rbac/im/dto/SetMuteRequest.java \
        backend/src/main/java/com/rbac/im/controller/ImGroupController.java \
        backend/src/test/java/com/rbac/im/service/GroupServiceMuteTest.java
git commit -m "feat(im): 群禁言/解禁成员（PUT /members/{id}/mute）"
```

---

### Task 9: 解散群 + 群详情/成员列表（读接口）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/GroupService.java`
- Create: `backend/src/main/java/com/rbac/im/vo/ImGroupVO.java`, `ImGroupMemberVO.java`
- Modify: `backend/src/main/java/com/rbac/im/controller/ImGroupController.java`
- Test: `backend/src/test/java/com/rbac/im/service/GroupServiceQueryTest.java`
- Test: `backend/src/test/java/com/rbac/im/controller/ImGroupControllerMockMvcTest.java`

**Interfaces:**
- Produces:
  - `GroupService.dissolve(long operatorId, long groupId)`
  - `GroupService.getGroup(long groupId, long requesterId) -> ImGroupVO`
  - `GroupService.listMembers(long groupId, long requesterId) -> List<ImGroupMemberVO>`
  - `ImGroupVO{ Long groupId; String name; Long ownerId; Integer memberCount; String myRole; }`
  - `ImGroupMemberVO{ Long userId; String role; boolean muted; }`

- [ ] **Step 1: 写失败测试（service 层）**

创建 `GroupServiceQueryTest.java`：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.vo.CreateGroupResult;
import com.rbac.im.vo.ImGroupMemberVO;
import com.rbac.im.vo.ImGroupVO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class GroupServiceQueryTest {

    @Autowired GroupService groupService;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired ImMessageRepository repo;

    @Test
    void getGroup_forMember() {
        CreateGroupResult r = groupService.createGroup(7001L, "群Q", List.of(7002L));
        ImGroupVO vo = groupService.getGroup(r.getGroupId(), 7001L);
        assertThat(vo.getName()).isEqualTo("群Q");
        assertThat(vo.getOwnerId()).isEqualTo(7001L);
        assertThat(vo.getMemberCount()).isEqualTo(2);
        assertThat(vo.getMyRole()).isEqualTo("OWNER");
    }

    @Test
    void getGroup_nonMember_403() {
        CreateGroupResult r = groupService.createGroup(7101L, "群", List.of(7102L));
        assertThatThrownBy(() -> groupService.getGroup(r.getGroupId(), 9999L))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("code", 403);
    }

    @Test
    void listMembers_returnsRolesAndMute() {
        CreateGroupResult r = groupService.createGroup(7201L, "群", List.of(7202L));
        groupService.setMute(7201L, r.getGroupId(), 7202L, true);
        List<ImGroupMemberVO> members = groupService.listMembers(r.getGroupId(), 7201L);
        assertThat(members).hasSize(2);
        assertThat(members).anyMatch(m -> m.getUserId() == 7202L && m.isMuted());
    }

    @Test
    void dissolve_emitsSystem_thenSoftDeletes() {
        CreateGroupResult r = groupService.createGroup(7301L, "群", List.of(7302L));
        groupService.dissolve(7301L, r.getGroupId());

        // 解散前发出了 GROUP_DISSOLVE（在软删前扇出并落库）
        List<ImMessage> msgs = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(r.getCid(), 0L, Limit.of(20));
        assertThat(msgs).anyMatch(m -> "SYSTEM".equals(m.getType()) && "GROUP_DISSOLVE".equals(m.getBody().get("event")));

        // 会话已软删（selectOne 查不到 deleted=0 的行）
        ImConversation c = conversationMapper.selectOne(new LambdaQueryWrapper<ImConversation>()
                .eq(ImConversation::getCid, r.getCid()));
        assertThat(c).isNull();

        // 非成员（已解散）再操作报错
        assertThatThrownBy(() -> groupService.getGroup(r.getGroupId(), 7301L))
                .isInstanceOf(BusinessException.class);
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceQueryTest`
Expected: 编译失败——`dissolve`/`getGroup`/`listMembers`/VO 不存在。

- [ ] **Step 3: 建 VO**

`vo/ImGroupVO.java`：

```java
package com.rbac.im.vo;

import lombok.Data;

@Data
public class ImGroupVO {
    private Long groupId;
    private String name;
    private Long ownerId;
    private Integer memberCount;
    private String myRole;
}
```

`vo/ImGroupMemberVO.java`：

```java
package com.rbac.im.vo;

import lombok.Data;

@Data
public class ImGroupMemberVO {
    private Long userId;
    private String role;
    private boolean muted;
}
```

- [ ] **Step 4: 实现 `dissolve` / `getGroup` / `listMembers`**

在 `GroupService.java` 追加（需 import `java.util.List`、`ImGroupVO`、`ImGroupMemberVO`）：

```java
    @Transactional
    public void dissolve(long operatorId, long groupId) {
        ImGroupMember op = requireMember(groupId, operatorId);
        requireOwner(op);
        String cid = "g_" + groupId;
        // 先扇出解散通知给在线成员，再软删（离线成员漏收为已知局限）
        postSystem(cid, operatorId, "GROUP_DISSOLVE", null, null);
        groupMapper.deleteById(groupId);
        groupMemberMapper.delete(new LambdaQueryWrapper<ImGroupMember>().eq(ImGroupMember::getGroupId, groupId));
        conversationService.removeConversation(cid);
    }

    public ImGroupVO getGroup(long groupId, long requesterId) {
        ImGroupMember me = requireMember(groupId, requesterId);
        ImGroup g = groupMapper.selectById(groupId);
        if (g == null) {
            throw new BusinessException(404, "im.group.notFound");
        }
        ImGroupVO vo = new ImGroupVO();
        vo.setGroupId(groupId);
        vo.setName(g.getName());
        vo.setOwnerId(g.getOwnerId());
        vo.setMemberCount((int) memberCount(groupId));
        vo.setMyRole(me.getRole());
        return vo;
    }

    public List<ImGroupMemberVO> listMembers(long groupId, long requesterId) {
        requireMember(groupId, requesterId);
        return groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                        .eq(ImGroupMember::getGroupId, groupId))
                .stream().map(m -> {
                    ImGroupMemberVO vo = new ImGroupMemberVO();
                    vo.setUserId(m.getUserId());
                    vo.setRole(m.getRole());
                    vo.setMuted(m.getMuted() != null && m.getMuted() == 1);
                    return vo;
                }).toList();
    }
```

- [ ] **Step 5: 控制器接口（GET + DELETE 群）**

在 `ImGroupController.java` 追加（补 import `GetMapping`；`ImGroupVO`/`ImGroupMemberVO`/`List`）：

```java
    @GetMapping("/{groupId}")
    public Result<ImGroupVO> detail(@PathVariable Long groupId) {
        return Result.success(groupService.getGroup(groupId, SecurityUtils.getUserId()));
    }

    @GetMapping("/{groupId}/members")
    public Result<List<ImGroupMemberVO>> members(@PathVariable Long groupId) {
        return Result.success(groupService.listMembers(groupId, SecurityUtils.getUserId()));
    }

    @DeleteMapping("/{groupId}")
    public Result<Void> dissolve(@PathVariable Long groupId) {
        groupService.dissolve(SecurityUtils.getUserId(), groupId);
        return Result.success();
    }
```

- [ ] **Step 6: 控制器 MockMvc 冒烟测试（鉴权 + 路由联通）**

创建 `ImGroupControllerMockMvcTest.java`，沿用现有 `ImApiMockMvcTest` 的鉴权造数方式（读取该文件复用其登录/token 或 `@WithMockUser`/`SecurityContext` 设置手法）：

```java
package com.rbac.im.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ImGroupControllerMockMvcTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;

    // 复用 ImApiMockMvcTest 中的 token 获取方式，替换 <AUTH> 为其真实鉴权手法。
    // 断言：已登录用户 POST /api/im/groups 建群返回 200 且 data.cid 形如 g_*。
    @Test
    void createGroup_viaRest() throws Exception {
        String body = om.writeValueAsString(Map.of("name", "MVC群", "memberIds", java.util.List.of()));
        mvc.perform(post("/api/im/groups")
                        /* <AUTH: 加上 ImApiMockMvcTest 同款鉴权，如 .header("Authorization","Bearer "+token)> */
                        .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cid").value(org.hamcrest.Matchers.startsWith("g_")));
    }
}
```

> 执行者：打开 `backend/src/test/java/com/rbac/im/controller/ImApiMockMvcTest.java`，把其鉴权/token 生成方式照搬到 `<AUTH>` 处；context-path `/api` 由测试框架处理（现有 MockMvc 测试怎么写路径就怎么写）。

- [ ] **Step 7: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceQueryTest,ImGroupControllerMockMvcTest`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/GroupService.java \
        backend/src/main/java/com/rbac/im/vo/ImGroupVO.java \
        backend/src/main/java/com/rbac/im/vo/ImGroupMemberVO.java \
        backend/src/main/java/com/rbac/im/controller/ImGroupController.java \
        backend/src/test/java/com/rbac/im/service/GroupServiceQueryTest.java \
        backend/src/test/java/com/rbac/im/controller/ImGroupControllerMockMvcTest.java
git commit -m "feat(im): 群解散+群详情/成员列表读接口"
```

---

### Task 10: 全量回归 + 收尾

**Files:** 无新增（回归与文档）。

- [x] **Step 1: 跑全部 IM 测试**

Run: `mvn -f backend/pom.xml test -Dtest='com.rbac.im.**'`
Expected: 全绿。若失败，按 `superpowers:systematic-debugging` 定位，勿盲改。

- [x] **Step 2: 全量构建**

Run: `mvn -f backend/pom.xml -q package -DskipTests=false`
Expected: BUILD SUCCESS。

- [x] **Step 3: 更新设计里程碑勾选（可选）**

在 `docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` 里程碑 5 旁注记"已完成（feat/im）"。

- [x] **Step 4: 提交**

```bash
git add -A
git commit -m "test(im): 群聊里程碑5 全量回归通过；标记里程碑5完成"
```

---

## Self-Review（作者自查记录）

- **Spec 覆盖**：建群/加/踢/退/解散/改名/转让/设免管理员/群禁言 → Task 4~9 全覆盖；SYSTEM 全生命周期事件 → 各 op 均 `postSystem`（GROUP_CREATE/MEMBER_JOIN/MEMBER_LEAVE/MEMBER_KICK/GROUP_DISSOLVE/GROUP_RENAME/OWNER_TRANSFER/ADMIN_CHANGE/MEMBER_MUTE）；发送成员校验+群禁言拦截+ERROR 帧 → Task 3；`last_msg_seq` 缺口修复 → Task 1；成员上限配置 → Task 4/5；新成员未读初始化 → `addConversationMember`（Task 4）；权限矩阵 → `requireMember/requireManage/requireOwner` + 各方法角色判定；双表事务同步 → `@Transactional` + group_member/conversation_member 成对增删。
- **判断点**：新成员可见全量历史但 `last_read_seq` 置当前 seq（Task 4 `addConversationMember`）；解散先扇出后软删、接受离线漏收（Task 9 `dissolve`，测试断言先落库）。
- **类型一致性**：`MessageAppender.append(String,Long,String,Map,String)->long`、`ConversationService.isGroupMuted/groupIdFromCid/ensureGroupConversation/addConversationMember/removeConversationMember/removeConversation`、`OutboundDispatcher.dispatchToUser(long,Envelope)`、各 `GroupService` 方法签名跨 Task 一致。
- **占位符**：无 TODO/TBD；唯一需执行者补全处为 Task 9 Step 6 的 `<AUTH>`（明确指向 `ImApiMockMvcTest` 现成手法），其余均给出完整代码。
- **网关**：全程未改 im-gateway，符合范围约束。
