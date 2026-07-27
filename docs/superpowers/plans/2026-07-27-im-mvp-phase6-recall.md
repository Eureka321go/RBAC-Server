# IM 里程碑 8 消息撤回 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `recall(cid, targetSeq)`：本人或群管理员在时间窗内撤回消息，原消息标记 `recalled` 且正文清空，生成 RECALL 控制消息扇出，pull 多端一致且绝不回原文。

**Architecture:** 撤回请求作为 op=`RECALL` 的 Envelope 复用现有 Kafka `im-inbound` 链路；`InboundMessageConsumer` 按 op 分支到新增 `RecallService`。RecallService 做 6 步校验后原子清正文 + 标记 recalled，再复用 `MessageAppender.append` 扇出一条 RECALL 控制消息。pull 侧 `MessageQueryService.toVo` 对 recalled 消息清空 body。

**Tech Stack:** Java 21 + Spring Boot 3.4.1 + Spring Data MongoDB + MyBatis-Plus + Kafka；测试 JUnit 5 + Mockito + AssertJ + `@SpringBootTest`（容器类）。

## Global Constraints

- 分支：`feat/im`（长期集成干线，不合 main）。
- 权限（用户已定）：单聊仅本人可撤；群聊本人或 OWNER/ADMIN 可撤；时间窗对所有人（含管理员）生效。
- 入口：复用 Kafka `im-inbound`，`InboundMessageConsumer` 按 op 分支；**不新增 REST 端点**。
- 撤回时间窗配置：`rbac.im.recall-window-seconds`（application.yml 已有=120），读法用 `@Value("${rbac.im.recall-window-seconds:120}")`。
- 原消息正文清空用点路径原子 `$set`（不整档覆盖），与既有 `updateLink` 同风格。
- 富媒体撤回**不**即时删 MinIO 对象（仅逻辑撤回）。
- 提交信息 trailer 沿用仓库约定（Co-Authored-By / Claude-Session）。
- Spec：`docs/superpowers/specs/2026-07-27-im-mvp-phase6-recall-design.md`。

---

### Task 1: 原子清正文 + 标记 recalled（Mongo 自定义片段）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/doc/ImMessageRepositoryCustom.java`
- Modify: `backend/src/main/java/com/rbac/im/doc/ImMessageRepositoryImpl.java`
- Test: `backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryImplTest.java`（新增用例）

**Interfaces:**
- Produces: `void ImMessageRepositoryCustom.markRecalled(String cid, long seq)` —— 对 cid+seq 定位文档原子 `$set { recalled:true, body:{} }`。

- [ ] **Step 1: 写失败测试**（追加到 `ImMessageRepositoryImplTest`）

```java
    @Test
    void markRecalled_sets_recalled_and_clears_body_by_cid_and_seq() {
        MongoTemplate template = mock(MongoTemplate.class);
        ImMessageRepositoryImpl repo = new ImMessageRepositoryImpl(template);

        repo.markRecalled("c_1_2", 42L);

        ArgumentCaptor<Query> q = ArgumentCaptor.forClass(Query.class);
        ArgumentCaptor<Update> u = ArgumentCaptor.forClass(Update.class);
        verify(template).updateFirst(q.capture(), u.capture(), eq(ImMessage.class));

        assertThat(q.getValue().getQueryObject().get("cid")).isEqualTo("c_1_2");
        assertThat(q.getValue().getQueryObject().get("seq")).isEqualTo(42L);
        String updateJson = u.getValue().getUpdateObject().toJson();
        assertThat(updateJson).contains("recalled").contains("body");
        // recalled 置真
        assertThat(u.getValue().getUpdateObject().get("$set")).isNotNull();
    }
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=ImMessageRepositoryImplTest`
Expected: 编译失败 `cannot find symbol: method markRecalled`。

- [ ] **Step 3: 接口加方法**（`ImMessageRepositoryCustom.java`，在 `updateLink` 下方）

```java
    /** 对 cid+seq 定位的文档原子 $set recalled=true 且清空 body（不整档覆盖）。 */
    void markRecalled(String cid, long seq);
```

- [ ] **Step 4: 实现**（`ImMessageRepositoryImpl.java`，在 `updateLink` 方法下方新增；`java.util.LinkedHashMap` 已 import）

```java
    @Override
    public void markRecalled(String cid, long seq) {
        Query q = new Query(Criteria.where("cid").is(cid).and("seq").is(seq));
        Update u = new Update().set("recalled", true).set("body", new LinkedHashMap<>());
        template.updateFirst(q, u, ImMessage.class);
    }
```

- [ ] **Step 5: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=ImMessageRepositoryImplTest`
Expected: PASS（2 用例）。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/doc/ImMessageRepositoryCustom.java \
        backend/src/main/java/com/rbac/im/doc/ImMessageRepositoryImpl.java \
        backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryImplTest.java
git commit -m "feat(im): ImMessageRepository.markRecalled 原子清正文+标记 recalled"
```

---

### Task 2: 按 cid+seq 精确查一条消息

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/doc/ImMessageRepository.java`
- Test: `backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryTest.java`（新增用例，真 Mongo 容器）

**Interfaces:**
- Produces: `Optional<ImMessage> ImMessageRepository.findByCidAndSeq(String cid, Long seq)` —— 派生查询，命中唯一 (cid,seq)。

- [ ] **Step 1: 写失败测试**（追加到 `ImMessageRepositoryTest`；顶部补 `import java.util.Optional;`）

```java
    @Test
    void findByCidAndSeq_returns_the_row() {
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc("c_9_9", 0L));

        ImMessage m = new ImMessage();
        m.setCid("c_9_9");
        m.setSeq(7L);
        m.setMsgId("m7");
        m.setSenderId(9L);
        m.setType("TEXT");
        m.setBody(Map.of("text", "hi"));
        m.setTs(System.currentTimeMillis());
        repo.save(m);

        Optional<ImMessage> got = repo.findByCidAndSeq("c_9_9", 7L);
        assertEquals(true, got.isPresent());
        assertEquals(9L, got.get().getSenderId());
        assertEquals(true, repo.findByCidAndSeq("c_9_9", 999L).isEmpty());
    }
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=ImMessageRepositoryTest`
Expected: 编译失败 `cannot find symbol: method findByCidAndSeq`。

- [ ] **Step 3: 加派生方法**（`ImMessageRepository.java`，顶部补 `import java.util.Optional;`）

```java
    Optional<ImMessage> findByCidAndSeq(String cid, Long seq);
```

- [ ] **Step 4: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=ImMessageRepositoryTest`
Expected: PASS（2 用例）。需本地/CI 有 Mongo（test profile）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/doc/ImMessageRepository.java \
        backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryTest.java
git commit -m "feat(im): ImMessageRepository.findByCidAndSeq 精确查一条"
```

---

### Task 3: 群管理员判定 isGroupManager

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/GroupService.java`
- Test: `backend/src/test/java/com/rbac/im/service/GroupServiceAdminTest.java`（新增用例，容器）

**Interfaces:**
- Produces: `boolean GroupService.isGroupManager(long groupId, long userId)` —— role ∈ {OWNER,ADMIN} 返回 true；成员不存在返回 false。

- [ ] **Step 1: 写失败测试**（追加到 `GroupServiceAdminTest`）

```java
    @Test
    void isGroupManager_true_for_owner_and_admin_false_for_member_and_absent() {
        CreateGroupResult r = groupService.createGroup(5601L, "群", List.of(5602L, 5603L));
        groupService.setRole(5601L, r.getGroupId(), 5602L, "ADMIN");

        assertThat(groupService.isGroupManager(r.getGroupId(), 5601L)).isTrue();  // OWNER
        assertThat(groupService.isGroupManager(r.getGroupId(), 5602L)).isTrue();  // ADMIN
        assertThat(groupService.isGroupManager(r.getGroupId(), 5603L)).isFalse(); // MEMBER
        assertThat(groupService.isGroupManager(r.getGroupId(), 9999L)).isFalse(); // 非成员
    }
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceAdminTest`
Expected: 编译失败 `cannot find symbol: method isGroupManager`。

- [ ] **Step 3: 实现**（`GroupService.java`，在 `isGroupMember` 方法下方新增；`LambdaQueryWrapper`/`ImGroupMember` 已 import）

```java
    /** 该用户在群内是否为管理员（OWNER 或 ADMIN）；成员不存在返回 false。 */
    public boolean isGroupManager(long groupId, long userId) {
        ImGroupMember m = groupMemberMapper.selectOne(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, groupId)
                .eq(ImGroupMember::getUserId, userId));
        return m != null && ("OWNER".equals(m.getRole()) || "ADMIN".equals(m.getRole()));
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=GroupServiceAdminTest`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/GroupService.java \
        backend/src/test/java/com/rbac/im/service/GroupServiceAdminTest.java
git commit -m "feat(im): GroupService.isGroupManager 判 OWNER/ADMIN"
```

---

### Task 4: RecallService 撤回编排（核心）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/RecallService.java`
- Test: `backend/src/test/java/com/rbac/im/service/RecallServiceTest.java`

**Interfaces:**
- Consumes: `ImMessageRepository.findByCidAndSeq(String,Long)`（Task 2）、`ImMessageRepository.markRecalled(String,long)`（Task 1）、`GroupService.isGroupManager(long,long)`（Task 3）、`MessageAppender.append(String cid, Long senderId, String type, Map<String,Object> body, String clientMsgId)`、`ConversationService.isMember(String,long)`、`ConversationService.groupIdFromCid(String)`（静态）、`OutboundDispatcher.dispatchToUser(long userId, Envelope env)`。
- Produces: `void RecallService.recall(Envelope env)` —— 校验+执行；失败定向回操作者 ERROR。

- [ ] **Step 1: 写失败测试**（新建 `RecallServiceTest.java`）

```java
package com.rbac.im.service;

import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RecallServiceTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final MessageAppender appender = mock(MessageAppender.class);
    private final ConversationService conv = mock(ConversationService.class);
    private final GroupService group = mock(GroupService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);

    // recallWindowSeconds=120（构造注入，绕开 Spring @Value）
    private final RecallService svc =
            new RecallService(repo, appender, conv, group, dispatcher, 120);

    private ImMessage target(String cid, long seq, long senderId, String type, long ts) {
        ImMessage m = new ImMessage();
        m.setCid(cid);
        m.setSeq(seq);
        m.setMsgId("m" + seq);
        m.setSenderId(senderId);
        m.setType(type);
        m.setBody(Map.of("text", "secret"));
        m.setTs(ts);
        return m;
    }

    private Envelope recallEnv(String cid, long operatorId, long targetSeq) {
        Envelope e = new Envelope();
        e.setOp("RECALL");
        e.setCid(cid);
        e.setSenderId(operatorId);
        e.setBody(Map.of("targetSeq", targetSeq));
        return e;
    }

    @Test
    void self_recall_within_window_marks_and_fans_out() {
        when(conv.isMember("c_1_2", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L))
                .thenReturn(Optional.of(target("c_1_2", 5L, 1L, "TEXT", System.currentTimeMillis())));

        svc.recall(recallEnv("c_1_2", 1L, 5L));

        verify(repo).markRecalled("c_1_2", 5L);
        verify(appender).append("c_1_2", 1L, "RECALL", Map.of("targetSeq", 5L), null);
        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=RecallServiceTest`
Expected: 编译失败（`RecallService` 不存在）。

- [ ] **Step 3: 实现 RecallService**（新建）

```java
package com.rbac.im.service;

import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Optional;

/** 消息撤回编排：6 步校验 + 原子清正文/标记 + RECALL 控制消息扇出。 */
@Service
public class RecallService {

    private final ImMessageRepository repo;
    private final MessageAppender appender;
    private final ConversationService conversationService;
    private final GroupService groupService;
    private final OutboundDispatcher dispatcher;
    private final int recallWindowSeconds;

    public RecallService(ImMessageRepository repo,
                         MessageAppender appender,
                         ConversationService conversationService,
                         GroupService groupService,
                         OutboundDispatcher dispatcher,
                         @Value("${rbac.im.recall-window-seconds:120}") int recallWindowSeconds) {
        this.repo = repo;
        this.appender = appender;
        this.conversationService = conversationService;
        this.groupService = groupService;
        this.dispatcher = dispatcher;
        this.recallWindowSeconds = recallWindowSeconds;
    }

    public void recall(Envelope env) {
        String cid = env.getCid();
        long operatorId = env.getSenderId();

        // 1) 成员校验
        if (!conversationService.isMember(cid, operatorId)) {
            pushError(env, "NOT_MEMBER");
            return;
        }

        // 2) 目标存在（targetSeq 缺失/非数字一并按目标不存在处理）
        Long targetSeq = parseTargetSeq(env.getBody());
        if (targetSeq == null) {
            pushError(env, "RECALL_TARGET_NOT_FOUND");
            return;
        }
        Optional<ImMessage> opt = repo.findByCidAndSeq(cid, targetSeq);
        if (opt.isEmpty()) {
            pushError(env, "RECALL_TARGET_NOT_FOUND");
            return;
        }
        ImMessage target = opt.get();

        // 3) 类型可撤
        if ("SYSTEM".equals(target.getType()) || "RECALL".equals(target.getType())) {
            pushError(env, "NOT_RECALLABLE");
            return;
        }

        // 4) 幂等：已撤回 → 静默返回（扛 Kafka 重投 + 重复点击）
        if (target.isRecalled()) {
            return;
        }

        // 5) 权限：本人；或群会话且操作者为 OWNER/ADMIN
        boolean allowed = target.getSenderId() != null && target.getSenderId() == operatorId;
        if (!allowed) {
            Long groupId = ConversationService.groupIdFromCid(cid);
            if (groupId != null && groupService.isGroupManager(groupId, operatorId)) {
                allowed = true;
            }
        }
        if (!allowed) {
            pushError(env, "RECALL_NO_PERMISSION");
            return;
        }

        // 6) 时间窗（对所有人生效，含管理员）
        long ts = target.getTs() == null ? 0L : target.getTs();
        if (System.currentTimeMillis() - ts > recallWindowSeconds * 1000L) {
            pushError(env, "RECALL_WINDOW_EXPIRED");
            return;
        }

        // 执行：先清正文/标记，再扇出 RECALL 控制消息
        repo.markRecalled(cid, targetSeq);
        appender.append(cid, operatorId, "RECALL", Map.of("targetSeq", targetSeq), null);
    }

    private Long parseTargetSeq(Map<String, Object> body) {
        if (body == null) {
            return null;
        }
        Object raw = body.get("targetSeq");
        return raw instanceof Number n ? n.longValue() : null;
    }

    private void pushError(Envelope src, String reason) {
        Envelope err = new Envelope();
        err.setOp("ERROR");
        err.setCid(src.getCid());
        err.setSenderId(src.getSenderId());
        err.setBody(Map.of("reason", reason));
        dispatcher.dispatchToUser(src.getSenderId(), err);
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=RecallServiceTest`
Expected: PASS（1 用例）。

- [ ] **Step 5: 补齐分支测试**（追加到 `RecallServiceTest`）

```java
    @Test
    void group_admin_can_recall_member_message() {
        when(conv.isMember("g_10", 2L)).thenReturn(true);
        when(repo.findByCidAndSeq("g_10", 5L))
                .thenReturn(Optional.of(target("g_10", 5L, 1L, "TEXT", System.currentTimeMillis())));
        when(group.isGroupManager(10L, 2L)).thenReturn(true);

        svc.recall(recallEnv("g_10", 2L, 5L)); // 操作者 2 撤成员 1 的消息

        verify(repo).markRecalled("g_10", 5L);
        verify(appender).append("g_10", 2L, "RECALL", Map.of("targetSeq", 5L), null);
    }

    @Test
    void single_chat_non_sender_is_rejected() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L))
                .thenReturn(Optional.of(target("c_1_2", 5L, 1L, "TEXT", System.currentTimeMillis())));

        svc.recall(recallEnv("c_1_2", 2L, 5L)); // 单聊 groupId 为 null → 只能本人

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(appender, never()).append(any(), any(), any(), any(), any());
        verify(dispatcher).dispatchToUser(eq(2L), argThat(e ->
                "ERROR".equals(e.getOp()) && "RECALL_NO_PERMISSION".equals(e.getBody().get("reason"))));
    }

    @Test
    void group_plain_member_recalling_others_is_rejected() {
        when(conv.isMember("g_10", 3L)).thenReturn(true);
        when(repo.findByCidAndSeq("g_10", 5L))
                .thenReturn(Optional.of(target("g_10", 5L, 1L, "TEXT", System.currentTimeMillis())));
        when(group.isGroupManager(10L, 3L)).thenReturn(false);

        svc.recall(recallEnv("g_10", 3L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(3L), argThat(e ->
                "RECALL_NO_PERMISSION".equals(e.getBody().get("reason"))));
    }

    @Test
    void expired_window_is_rejected_even_for_own_message() {
        long old = System.currentTimeMillis() - 200_000L; // 200s > 120s 窗
        when(conv.isMember("c_1_2", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L))
                .thenReturn(Optional.of(target("c_1_2", 5L, 1L, "TEXT", old)));

        svc.recall(recallEnv("c_1_2", 1L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(1L), argThat(e ->
                "RECALL_WINDOW_EXPIRED".equals(e.getBody().get("reason"))));
    }

    @Test
    void admin_expired_window_also_rejected() {
        long old = System.currentTimeMillis() - 200_000L;
        when(conv.isMember("g_10", 2L)).thenReturn(true);
        when(repo.findByCidAndSeq("g_10", 5L))
                .thenReturn(Optional.of(target("g_10", 5L, 1L, "TEXT", old)));
        when(group.isGroupManager(10L, 2L)).thenReturn(true);

        svc.recall(recallEnv("g_10", 2L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(2L), argThat(e ->
                "RECALL_WINDOW_EXPIRED".equals(e.getBody().get("reason"))));
    }

    @Test
    void target_not_found_is_rejected() {
        when(conv.isMember("c_1_2", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L)).thenReturn(Optional.empty());

        svc.recall(recallEnv("c_1_2", 1L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(1L), argThat(e ->
                "RECALL_TARGET_NOT_FOUND".equals(e.getBody().get("reason"))));
    }

    @Test
    void recalling_system_or_recall_type_is_rejected() {
        when(conv.isMember("g_10", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("g_10", 5L))
                .thenReturn(Optional.of(target("g_10", 5L, 1L, "SYSTEM", System.currentTimeMillis())));

        svc.recall(recallEnv("g_10", 1L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(1L), argThat(e ->
                "NOT_RECALLABLE".equals(e.getBody().get("reason"))));
    }

    @Test
    void already_recalled_is_idempotent_silent() {
        ImMessage t = target("c_1_2", 5L, 1L, "TEXT", System.currentTimeMillis());
        t.setRecalled(true);
        when(conv.isMember("c_1_2", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L)).thenReturn(Optional.of(t));

        svc.recall(recallEnv("c_1_2", 1L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(appender, never()).append(any(), any(), any(), any(), any());
        verify(dispatcher, never()).dispatchToUser(anyLong(), any()); // 不报错
    }

    @Test
    void non_member_is_rejected() {
        when(conv.isMember("c_1_2", 9L)).thenReturn(false);

        svc.recall(recallEnv("c_1_2", 9L, 5L));

        verify(repo, never()).findByCidAndSeq(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(9L), argThat(e ->
                "NOT_MEMBER".equals(e.getBody().get("reason"))));
    }
```

- [ ] **Step 6: 运行确认全绿**

Run: `mvn -f backend/pom.xml test -Dtest=RecallServiceTest`
Expected: PASS（10 用例）。

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/RecallService.java \
        backend/src/test/java/com/rbac/im/service/RecallServiceTest.java
git commit -m "feat(im): RecallService 6步校验+原子撤回+RECALL 控制消息扇出"
```

---

### Task 5: 会话摘要 RECALL 文案

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/MessageAppender.java`（`preview` 方法）
- Test: `backend/src/test/java/com/rbac/im/service/MessageAppenderTest.java`（新增用例）

**Interfaces:**
- Consumes: `MessageAppender.preview(String type, Map<String,Object> body)`（包级静态，已存在）。

- [ ] **Step 1: 写失败测试**（追加到 `MessageAppenderTest`）

```java
    @Test
    void preview_of_recall_is_friendly_text() {
        assertThat(MessageAppender.preview("RECALL", java.util.Map.of("targetSeq", 5L)))
                .isEqualTo("[撤回了一条消息]");
    }
```

> 若 `MessageAppenderTest` 未静态导入 AssertJ，请用文件既有断言风格（如 `assertEquals("[撤回了一条消息]", MessageAppender.preview("RECALL", Map.of("targetSeq", 5L)))`）。

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=MessageAppenderTest`
Expected: FAIL（返回 `[RECALL]` ≠ `[撤回了一条消息]`）。

- [ ] **Step 3: 实现**（`MessageAppender.preview` 内，`SYSTEM` 分支之后、`return "[" + type + "]"` 之前插入）

```java
        if ("RECALL".equals(type)) {
            return "[撤回了一条消息]";
        }
```

- [ ] **Step 4: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=MessageAppenderTest`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/MessageAppender.java \
        backend/src/test/java/com/rbac/im/service/MessageAppenderTest.java
git commit -m "feat(im): 会话摘要 RECALL 文案 [撤回了一条消息]"
```

---

### Task 6: pull 侧撤回消息 body 清空（闭合 FU-2）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/MessageQueryService.java`（`toVo`）
- Test: `backend/src/test/java/com/rbac/im/service/MessageQueryServiceTest.java`（新增用例）

**Interfaces:**
- Consumes: `MessageQueryService.toVo(ImMessage)`（私有；经 `pull` 间接覆盖）。

- [ ] **Step 1: 写失败测试**（追加到 `MessageQueryServiceTest`；沿用该文件既有 mock 装配方式构造 service 与 `repo`/`conversationService`/`enricher`）

```java
    @Test
    void pull_blanks_body_of_recalled_message() {
        // 约定：本用例请沿用 MessageQueryServiceTest 既有的 mock 装配（repo/conversationService/enricher）
        // 构造一条 recalled=true 的 ImMessage 让 repo.findByCidAndSeqGreaterThanOrderBySeqAsc 返回
        com.rbac.im.doc.ImMessage m = new com.rbac.im.doc.ImMessage();
        m.setCid("c_1_2");
        m.setSeq(3L);
        m.setMsgId("m3");
        m.setSenderId(1L);
        m.setType("TEXT");
        m.setBody(java.util.Map.of("text", "secret"));
        m.setRecalled(true);
        m.setTs(1L);

        when(conversationService.isMember("c_1_2", 1L)).thenReturn(true);
        when(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(eq("c_1_2"), eq(0L), any()))
                .thenReturn(java.util.List.of(m));

        com.rbac.im.vo.PullResult res = service.pull("c_1_2", 0L, 50, 1L);

        com.rbac.im.vo.ImMessageVO vo = res.getMessages().get(0);
        assertThat(vo.isRecalled()).isTrue();
        assertThat(vo.getBody()).isEmpty();                 // 正文不外泄
        verify(enricher, never()).enrich(eq("TEXT"), eq(java.util.Map.of("text", "secret")));
    }
```

> 若现有 `MessageQueryServiceTest` 里 mock 字段名不同（如非 `service`/`repo`/`conversationService`/`enricher`），实现者按该文件真实命名对齐；语义保持不变：recalled 消息 `body` 为空且不调用 `enricher`。

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=MessageQueryServiceTest`
Expected: FAIL（当前 toVo 无条件走 enricher，body 非空）。

- [ ] **Step 3: 实现**（`MessageQueryService.toVo`，把 `vo.setBody(...)` 一行改为条件分支）

```java
        if (m.isRecalled()) {
            vo.setBody(java.util.Map.of());
        } else {
            vo.setBody(enricher.enrich(m.getType(), m.getBody()));
        }
```

- [ ] **Step 4: 运行确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=MessageQueryServiceTest`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/MessageQueryService.java \
        backend/src/test/java/com/rbac/im/service/MessageQueryServiceTest.java
git commit -m "feat(im): pull 侧撤回消息 body 清空，闭合 FU-2 不外泄正文"
```

---

### Task 7: InboundMessageConsumer 按 op 分支到 RecallService

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`
- Test: `backend/src/test/java/com/rbac/im/service/InboundMessageConsumerTest.java`（新增 RECALL 用例 + 更新构造）
- Modify（构造对齐）: `backend/src/test/java/com/rbac/im/service/InboundLinkTriggerTest.java`、`backend/src/test/java/com/rbac/im/service/InboundSendCheckTest.java`

**Interfaces:**
- Consumes: `RecallService.recall(Envelope)`（Task 4）。
- Produces: `InboundMessageConsumer` 构造新增末位参数 `RecallService recallService`。

- [ ] **Step 1: 写失败测试**（改 `InboundMessageConsumerTest`：加 `RecallService` mock，更新两处构造，加 RECALL 分支用例）

```java
    // 类字段区新增：
    private final RecallService recallService = mock(RecallService.class);

    // 已有用例里两处 new InboundMessageConsumer(...) 末尾追加 recallService 参数：
    //   new InboundMessageConsumer(repo, appender, conversationService, dispatcher, mediaService, linkPreview, recallService)

    @Test
    void recall_op_is_routed_to_recall_service_and_skips_append() throws Exception {
        Envelope e = new Envelope();
        e.setOp("RECALL");
        e.setCid("c_1_2");
        e.setSenderId(1L);
        e.setBody(Map.of("targetSeq", 5L));
        String json = mapper.writeValueAsString(e);

        InboundMessageConsumer c = new InboundMessageConsumer(
                repo, appender, conversationService, dispatcher,
                mock(MediaService.class), mock(LinkPreviewService.class), recallService);

        c.onMessage(json);

        verify(recallService).recall(argThat(env ->
                "RECALL".equals(env.getOp()) && "c_1_2".equals(env.getCid())
                        && env.getSenderId() == 1L));
        verify(appender, never()).append(any(), any(), any(), any(), any());
    }
```

- [ ] **Step 2: 运行确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=InboundMessageConsumerTest`
Expected: 编译失败（构造参数不匹配 / `recallService` 未定义）。

- [ ] **Step 3: 实现**（`InboundMessageConsumer.java`）

3a. 加字段与构造参数：

```java
    private final RecallService recallService;

    public InboundMessageConsumer(ImMessageRepository repo,
                                  MessageAppender appender,
                                  ConversationService conversationService,
                                  OutboundDispatcher dispatcher,
                                  MediaService mediaService,
                                  LinkPreviewService linkPreview,
                                  RecallService recallService) {
        this.repo = repo;
        this.appender = appender;
        this.conversationService = conversationService;
        this.dispatcher = dispatcher;
        this.mediaService = mediaService;
        this.linkPreview = linkPreview;
        this.recallService = recallService;
    }
```

3b. `onMessage` 解析 env 后、幂等检查之前，插入 op 分支：

```java
        Envelope env = mapper.readValue(json, Envelope.class);

        // 里程碑8：撤回走独立编排（自带成员/权限/时间窗校验）
        if ("RECALL".equals(env.getOp())) {
            recallService.recall(env);
            return;
        }
```

- [ ] **Step 4: 对齐另两处构造**（编译需要）

在 `InboundLinkTriggerTest.java` 与 `InboundSendCheckTest.java` 中，每处 `new InboundMessageConsumer(...)` 末尾追加一个 `RecallService` mock 参数（在类中加 `private final RecallService recallService = mock(RecallService.class);` 或就地 `mock(RecallService.class)`），语义不变。

- [ ] **Step 5: 运行确认通过（三测试类）**

Run: `mvn -f backend/pom.xml test -Dtest=InboundMessageConsumerTest,InboundLinkTriggerTest,InboundSendCheckTest`
Expected: PASS（全部，含原有用例无回归）。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java \
        backend/src/test/java/com/rbac/im/service/InboundMessageConsumerTest.java \
        backend/src/test/java/com/rbac/im/service/InboundLinkTriggerTest.java \
        backend/src/test/java/com/rbac/im/service/InboundSendCheckTest.java
git commit -m "feat(im): InboundMessageConsumer 按 op 分支，RECALL 路由到 RecallService"
```

---

### Task 8: 端到端 + 全量回归 + 标注里程碑完成

**Files:**
- Create（可选 E2E）: `backend/src/test/java/com/rbac/im/service/RecallE2ETest.java`（沿 `MutedSendE2ETest` 风格，容器）
- Modify: `docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md`（里程碑 8 标注完成）
- Modify: `.superpowers/sdd/progress.md`（新增里程碑 8 台账段）

**Interfaces:** 无新增。

- [ ] **Step 1: 写端到端测试（可选但推荐）**

参照 `MutedSendE2ETest`：建单聊会话 → `MessageAppender.append` 落一条 TEXT 拿 seq → 构造 RECALL Envelope 调 `RecallService.recall` → 断言：`repo.findByCidAndSeq` 该消息 `recalled==true` 且 `body` 为空；`MessageQueryService.pull` 结果含该消息（recalled、body 空）+ 一条 `type=RECALL` 且 `body.targetSeq` 指向原 seq 的控制消息。硬编码 id 的清理用物理删除（沿本仓库既有 IM 容器测试模式，规避 uk_cid 不含 deleted 坑）。

- [ ] **Step 2: 运行 E2E**

Run: `mvn -f backend/pom.xml test -Dtest=RecallE2ETest`
Expected: PASS。

- [ ] **Step 3: IM 全量回归**

Run: `mvn -f backend/pom.xml test -Dtest='com.rbac.im.**'`
Expected: BUILD SUCCESS，全绿（含既有里程碑 1-7 无回归）。

- [ ] **Step 4: 全量构建**

Run: `mvn -f backend/pom.xml package`
Expected: BUILD SUCCESS。

- [ ] **Step 5: 标注里程碑完成**

在设计文档 `docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` 里程碑列表第 8 项「撤回」后标注「✅ 已完成」（与里程碑 1-7 标注风格一致）；在 `.superpowers/sdd/progress.md` 顶部新增里程碑 8 台账段（各 Task 的 commit、findings、defer 清单）。

- [ ] **Step 6: 提交**

```bash
git add docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md \
        .superpowers/sdd/progress.md \
        backend/src/test/java/com/rbac/im/service/RecallE2ETest.java
git commit -m "test(im): 撤回端到端 + 里程碑8 全量回归绿，标注完成"
```

---

## Self-Review

**Spec coverage：**
- 协议 op=RECALL / body.targetSeq → Task 4、Task 7 ✅
- Kafka op 分支入口 → Task 7 ✅
- 6 步校验（成员/存在/类型/幂等/权限/时间窗） → Task 4 ✅
- 权限：单聊本人、群本人或 OWNER/ADMIN → Task 3 + Task 4 ✅
- 时间窗对所有人 → Task 4（`expired`/`admin_expired` 两用例）✅
- 原子清正文 + 标记 recalled → Task 1 + Task 4 ✅
- RECALL 控制消息扇出 → Task 4（append）✅
- 摘要文案 → Task 5 ✅
- pull 不外泄正文（FU-2） → Task 6 ✅
- 精确查目标消息 → Task 2 ✅
- 端到端多端一致 → Task 8 ✅
- follow-up（崩溃窗、MinIO GC）→ spec 已记，无需任务。

**Placeholder scan：** 无 TBD/TODO；所有代码步给出完整代码与命令。Task 6/7 对「测试文件既有命名」的对齐说明为必要的现场适配提示，非占位。

**Type consistency：** `markRecalled(String,long)`、`findByCidAndSeq(String,Long)→Optional<ImMessage>`、`isGroupManager(long,long)→boolean`、`recall(Envelope)`、`append(String,Long,String,Map,String)`、`dispatchToUser(long,Envelope)`、`groupIdFromCid(String)→Long`（静态）在各 Task 间一致。RECALL 文案字符串 `[撤回了一条消息]` 在 Task 5 定义、Task 8 E2E 不做字面断言（只断 type/targetSeq），无冲突。
