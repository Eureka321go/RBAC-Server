# IM 后端 MVP — 第二阶段实现计划（里程碑 4：离线消息 + 多端同步）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 backend 新增两个只读 REST 接口——会话列表同步与单会话增量拉取——让客户端上线后统一覆盖离线消息与多端同步。

**Architecture:** 纯 backend（`com.rbac.im`）REST，复用现有 `JwtAuthenticationFilter` + `SecurityUtils.getUserId()` 鉴权；消息按 `seq` 从 MongoDB 增量拉取（多取 1 条判断 `hasMore`），会话列表由 MySQL `im_conversation` + `im_conversation_member` 组装。im-gateway（Netty 网关）与 Kafka/WS 实时链路不改动。

**Tech Stack:** Java 21、Spring Boot 3.4.1、Spring Data MongoDB（`Limit`）、MyBatis-Plus 3.5.9、Spring Security（`spring-security-test` 已在 test scope）、JUnit 5。

## Global Constraints

- Java 版本：`21`。Spring Boot `3.4.1`；MyBatis-Plus `3.5.9`。
- 统一响应 `com.rbac.common.Result<T>`（`Result.success(data)`）；统一前缀 `/api`（context-path），Controller 的 `@RequestMapping` 写相对路径（如 `/im` → `/api/im`）。
- API camelCase；会话类型枚举固定字符串 `SINGLE`/`GROUP`；消息 `type` 本期只有 `TEXT`。
- 取当前用户：`com.rbac.common.util.SecurityUtils.getUserId()`（返回 `Long`，未登录抛 401）。
- 业务异常：`new BusinessException(int code, String messageKey)`；`GlobalExceptionHandler` 将其映射为 HTTP 200 + body `{code, message}`（故 MockMvc 断言用 `status().isOk()` + `jsonPath("$.code")`）。
- 成员校验不可绕过（安全红线）：非会话成员访问某 `cid` 一律 403。
- 新接口自动落入 `SecurityConfig` 的 `.anyRequest().authenticated()`，**无需改 SecurityConfig**。
- 测试：`@SpringBootTest @ActiveProfiles("test")`（连 `rbac_test` MySQL + `rbac_im` MongoDB + Redis）；Mongo 测试须可重复（用例开头按 `cid` 清理旧数据）。
- 只读、只做 forward 增量；不写库、不改位点、不做 history 回溯。
- commit 消息尾部必须带两行：
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PX86B1RYqe8ukTdtKtHsiK
  ```
- 单模块跑测试：`mvn -pl backend -Dtest=XxxTest test`（在仓库根 `/Users/xxmm/work/RBAC-Server` 执行）。提交只 `git add` 本 Task 相关文件，勿 `git add -A`（工作区有未跟踪 docs）。

---

## 文件结构（本阶段新建/修改）

**backend `com.rbac.im`**
- 修改 `doc/ImMessageRepository.java`：新增带 `Limit` 的按 seq 升序分页查询。
- 新建 `vo/ImConversationVO.java`、`vo/ImMessageVO.java`、`vo/PullResult.java`。
- 修改 `service/ConversationService.java`：新增 `isMember(cid, userId)`、`listMyConversations(userId)`。
- 新建 `service/MessageQueryService.java`：成员校验 + 增量拉取 + 组装 `PullResult`。
- 新建 `controller/ImConversationController.java`、`controller/ImMessageController.java`。
- 修改 `src/main/resources/i18n/messages.properties`、`messages_zh_CN.properties`、`messages_en_US.properties`：新增 `im.conversation.notMember`。

**测试**
- 新建 `test/.../im/doc/ImMessageRepositoryPageTest.java`
- 新建 `test/.../im/service/ConversationServiceListTest.java`
- 新建 `test/.../im/service/MessageQueryServiceTest.java`
- 新建 `test/.../im/controller/ImApiMockMvcTest.java`

---

## Task 1: 消息仓库增加带 limit 的增量分页查询

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/doc/ImMessageRepository.java`
- Test: `backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryPageTest.java`

**Interfaces:**
- Consumes: 现有 `ImMessage{id,cid,seq,msgId,senderId,type,body,recalled,clientMsgId,ts}`。
- Produces: `List<ImMessage> ImMessageRepository.findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, Long seq, org.springframework.data.domain.Limit limit)`（按 seq 升序，最多返回 `limit` 条）。

- [ ] **Step 1: 写失败测试**

Create `backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryPageTest.java`：

```java
package com.rbac.im.doc;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@ActiveProfiles("test")
class ImMessageRepositoryPageTest {

    private static final String CID = "c_page_1";

    @Autowired
    private ImMessageRepository repo;

    @BeforeEach
    void clean() {
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(CID, 0L));
    }

    private void save(long seq) {
        ImMessage m = new ImMessage();
        m.setCid(CID);
        m.setSeq(seq);
        m.setMsgId("m" + seq);
        m.setSenderId(1L);
        m.setType("TEXT");
        m.setBody(Map.of("text", "t" + seq));
        m.setClientMsgId("cli-" + seq);
        m.setTs(System.currentTimeMillis());
        repo.save(m);
    }

    @Test
    void since_and_limit_returns_ascending_slice() {
        for (long s = 1; s <= 5; s++) {
            save(s);
        }
        List<ImMessage> got = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(CID, 2L, Limit.of(2));
        assertEquals(2, got.size());
        assertEquals(3L, got.get(0).getSeq());
        assertEquals(4L, got.get(1).getSeq());
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `mvn -q -pl backend -Dtest=ImMessageRepositoryPageTest test`
Expected: 编译失败——`findByCidAndSeqGreaterThanOrderBySeqAsc(String, Long, Limit)` 不存在。

- [ ] **Step 3: 在仓库新增分页方法**

编辑 `backend/src/main/java/com/rbac/im/doc/ImMessageRepository.java`，加入 `Limit` 导入与新方法：

```java
package com.rbac.im.doc;

import org.springframework.data.domain.Limit;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface ImMessageRepository extends MongoRepository<ImMessage, String> {

    List<ImMessage> findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, Long seq);

    List<ImMessage> findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, Long seq, Limit limit);

    boolean existsBySenderIdAndClientMsgId(Long senderId, String clientMsgId);
}
```

- [ ] **Step 4: 运行测试**

Run: `mvn -q -pl backend -Dtest=ImMessageRepositoryPageTest test`（需 `docker compose --profile im up -d` 已起 MongoDB）
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/rbac/im/doc/ImMessageRepository.java \
        backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryPageTest.java
git commit -m "feat(im): 消息仓库增加带 limit 的增量分页查询"
```

---

## Task 2: 会话服务——成员校验与我的会话列表

**Files:**
- Create: `backend/src/main/java/com/rbac/im/vo/ImConversationVO.java`
- Modify: `backend/src/main/java/com/rbac/im/service/ConversationService.java`
- Test: `backend/src/test/java/com/rbac/im/service/ConversationServiceListTest.java`

**Interfaces:**
- Consumes: 现有 `ConversationService.ensureSingleConversation(long,long)`、`ImConversationMapper`、`ImConversationMemberMapper`、实体 `ImConversation{cid,type,groupId,lastMsgSeq,lastMsgPreview}`、`ImConversationMember{cid,userId,lastReadSeq}`。
- Produces:
  - `boolean ConversationService.isMember(String cid, long userId)`
  - `List<ImConversationVO> ConversationService.listMyConversations(long userId)`
  - `ImConversationVO{String cid; String type; Long groupId; Long lastMsgSeq; String lastMsgPreview; Long lastReadSeq; Long unreadCount;}`

- [ ] **Step 1: 新建 `ImConversationVO.java`**

Create `backend/src/main/java/com/rbac/im/vo/ImConversationVO.java`：

```java
package com.rbac.im.vo;

import lombok.Data;

/** 会话列表同步项。 */
@Data
public class ImConversationVO {
    private String cid;
    private String type;            // SINGLE / GROUP
    private Long groupId;
    private Long lastMsgSeq;
    private String lastMsgPreview;
    private Long lastReadSeq;
    private Long unreadCount;
}
```

- [ ] **Step 2: 写失败测试**

Create `backend/src/test/java/com/rbac/im/service/ConversationServiceListTest.java`：

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.vo.ImConversationVO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@ActiveProfiles("test")
class ConversationServiceListTest {

    @Autowired
    private ConversationService service;
    @Autowired
    private ImConversationMapper conversationMapper;
    @Autowired
    private ImConversationMemberMapper memberMapper;

    @Test
    void isMember_reflects_membership() {
        String cid = service.ensureSingleConversation(101, 102);
        assertTrue(service.isMember(cid, 101));
        assertTrue(service.isMember(cid, 102));
        assertFalse(service.isMember(cid, 999));
    }

    @Test
    void list_returns_only_my_conversations_with_unread() {
        String cid = service.ensureSingleConversation(201, 202);
        // 会话最新 seq 推到 5
        ImConversation c = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        c.setLastMsgSeq(5L);
        c.setLastMsgPreview("hi");
        conversationMapper.updateById(c);
        // 用户 201 已读到 3
        ImConversationMember m = memberMapper.selectOne(
                new LambdaQueryWrapper<ImConversationMember>()
                        .eq(ImConversationMember::getCid, cid)
                        .eq(ImConversationMember::getUserId, 201L));
        m.setLastReadSeq(3L);
        memberMapper.updateById(m);

        List<ImConversationVO> vos = service.listMyConversations(201);
        ImConversationVO vo = vos.stream().filter(v -> v.getCid().equals(cid)).findFirst().orElseThrow();
        assertEquals("SINGLE", vo.getType());
        assertEquals(5L, vo.getLastMsgSeq());
        assertEquals(3L, vo.getLastReadSeq());
        assertEquals(2L, vo.getUnreadCount());

        // 非成员看不到该会话
        assertTrue(service.listMyConversations(999).stream().noneMatch(v -> v.getCid().equals(cid)));
    }
}
```

- [ ] **Step 3: 运行，确认失败**

Run: `mvn -q -pl backend -Dtest=ConversationServiceListTest test`
Expected: 编译失败——`isMember` / `listMyConversations` 不存在。

- [ ] **Step 4: 在 `ConversationService` 实现两个方法**

编辑 `backend/src/main/java/com/rbac/im/service/ConversationService.java`，新增导入与方法（保留原有内容，在类内追加）：

现有 `ConversationService` 已导入 `ImConversation`、`ImConversationMember`、`ImConversationMapper`、`ImConversationMemberMapper`、`LambdaQueryWrapper`、`java.util.List`。**只需再补三行导入**（重复 import 会编译报错，务必只加这三行）：

```java
import com.rbac.im.vo.ImConversationVO;
import java.util.Map;
import java.util.stream.Collectors;
```

在类内追加方法：

```java
    /** 当前用户是否为该会话成员。 */
    public boolean isMember(String cid, long userId) {
        Long count = memberMapper.selectCount(
                new LambdaQueryWrapper<ImConversationMember>()
                        .eq(ImConversationMember::getCid, cid)
                        .eq(ImConversationMember::getUserId, userId));
        return count != null && count > 0;
    }

    /** 当前用户参与的会话列表（含未读数）。 */
    public List<ImConversationVO> listMyConversations(long userId) {
        List<ImConversationMember> members = memberMapper.selectList(
                new LambdaQueryWrapper<ImConversationMember>()
                        .eq(ImConversationMember::getUserId, userId));
        if (members.isEmpty()) {
            return List.of();
        }
        Map<String, Long> readSeqByCid = members.stream()
                .collect(Collectors.toMap(ImConversationMember::getCid,
                        m -> m.getLastReadSeq() == null ? 0L : m.getLastReadSeq(),
                        (a, b) -> a));
        List<String> cids = members.stream().map(ImConversationMember::getCid).toList();
        List<ImConversation> convs = conversationMapper.selectList(
                new LambdaQueryWrapper<ImConversation>().in(ImConversation::getCid, cids));
        return convs.stream().map(c -> {
            long lastMsgSeq = c.getLastMsgSeq() == null ? 0L : c.getLastMsgSeq();
            long lastReadSeq = readSeqByCid.getOrDefault(c.getCid(), 0L);
            ImConversationVO vo = new ImConversationVO();
            vo.setCid(c.getCid());
            vo.setType(c.getType());
            vo.setGroupId(c.getGroupId());
            vo.setLastMsgSeq(lastMsgSeq);
            vo.setLastMsgPreview(c.getLastMsgPreview());
            vo.setLastReadSeq(lastReadSeq);
            vo.setUnreadCount(Math.max(0L, lastMsgSeq - lastReadSeq));
            return vo;
        }).toList();
    }
```

> 注：`conversationMapper` 与 `memberMapper` 字段已存在于 `ConversationService`，直接复用。

- [ ] **Step 5: 运行测试**

Run: `mvn -q -pl backend -Dtest=ConversationServiceListTest test`（需 MySQL）
Expected: PASS（2 个用例）。

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/rbac/im/vo/ImConversationVO.java \
        backend/src/main/java/com/rbac/im/service/ConversationService.java \
        backend/src/test/java/com/rbac/im/service/ConversationServiceListTest.java
git commit -m "feat(im): 会话服务增加成员校验与我的会话列表（含未读数）"
```

---

## Task 3: 消息查询服务——成员校验 + 增量拉取 + 分页

**Files:**
- Create: `backend/src/main/java/com/rbac/im/vo/ImMessageVO.java`
- Create: `backend/src/main/java/com/rbac/im/vo/PullResult.java`
- Create: `backend/src/main/java/com/rbac/im/service/MessageQueryService.java`
- Modify: `backend/src/main/resources/i18n/messages.properties`
- Modify: `backend/src/main/resources/i18n/messages_zh_CN.properties`
- Modify: `backend/src/main/resources/i18n/messages_en_US.properties`
- Test: `backend/src/test/java/com/rbac/im/service/MessageQueryServiceTest.java`

**Interfaces:**
- Consumes: `ImMessageRepository.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, seq, Limit)`（Task 1）、`ConversationService.isMember(cid, userId)`（Task 2）、`BusinessException(int,String)`。
- Produces:
  - `ImMessageVO{String cid; Long seq; String msgId; Long senderId; String type; Map<String,Object> body; boolean recalled; Long ts;}`
  - `PullResult{List<ImMessageVO> messages; boolean hasMore; Long nextSinceSeq;}`
  - `PullResult MessageQueryService.pull(String cid, Long sinceSeq, Integer limit, long requesterUserId)`：非成员抛 `BusinessException(403,"im.conversation.notMember")`；`sinceSeq` 空按 0；`limit` 空按 50、>200 夹到 200、<=0 按 50。

- [ ] **Step 1: 新建 `ImMessageVO.java`**

Create `backend/src/main/java/com/rbac/im/vo/ImMessageVO.java`：

```java
package com.rbac.im.vo;

import lombok.Data;

import java.util.Map;

/** 下发给客户端的消息项（不含 clientMsgId）。 */
@Data
public class ImMessageVO {
    private String cid;
    private Long seq;
    private String msgId;
    private Long senderId;
    private String type;
    private Map<String, Object> body;
    private boolean recalled;
    private Long ts;
}
```

- [ ] **Step 2: 新建 `PullResult.java`**

Create `backend/src/main/java/com/rbac/im/vo/PullResult.java`：

```java
package com.rbac.im.vo;

import lombok.Data;

import java.util.List;

/** 单会话增量拉取结果。 */
@Data
public class PullResult {
    private List<ImMessageVO> messages;
    private boolean hasMore;
    private Long nextSinceSeq;
}
```

- [ ] **Step 3: 三个 i18n 文件补 `im.conversation.notMember`**

在 `backend/src/main/resources/i18n/messages.properties` 末尾追加：

```properties
im.conversation.notMember=Not a member of this conversation
```

在 `backend/src/main/resources/i18n/messages_en_US.properties` 末尾追加：

```properties
im.conversation.notMember=Not a member of this conversation
```

在 `backend/src/main/resources/i18n/messages_zh_CN.properties` 末尾追加：

```properties
im.conversation.notMember=非该会话成员，无权访问
```

- [ ] **Step 4: 写失败测试**

Create `backend/src/test/java/com/rbac/im/service/MessageQueryServiceTest.java`：

```java
package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.vo.PullResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@ActiveProfiles("test")
class MessageQueryServiceTest {

    @Autowired
    private MessageQueryService service;
    @Autowired
    private ConversationService conversationService;
    @Autowired
    private ImMessageRepository repo;

    private String cid;

    @BeforeEach
    void setup() {
        cid = conversationService.ensureSingleConversation(301, 302);
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L));
        for (long s = 1; s <= 5; s++) {
            ImMessage m = new ImMessage();
            m.setCid(cid);
            m.setSeq(s);
            m.setMsgId("m" + s);
            m.setSenderId(301L);
            m.setType("TEXT");
            m.setBody(Map.of("text", "t" + s));
            m.setClientMsgId("cli-" + s);
            m.setTs(System.currentTimeMillis());
            repo.save(m);
        }
    }

    @Test
    void non_member_gets_403() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.pull(cid, 0L, 50, 999L));
        assertEquals(403, ex.getCode());
    }

    @Test
    void incremental_since_seq() {
        PullResult r = service.pull(cid, 2L, 50, 301L);
        assertEquals(List.of(3L, 4L, 5L),
                r.getMessages().stream().map(v -> v.getSeq()).toList());
        assertFalse(r.isHasMore());
        assertEquals(5L, r.getNextSinceSeq());
    }

    @Test
    void paging_reports_has_more() {
        PullResult first = service.pull(cid, 0L, 2, 301L);
        assertEquals(List.of(1L, 2L),
                first.getMessages().stream().map(v -> v.getSeq()).toList());
        assertTrue(first.isHasMore());
        assertEquals(2L, first.getNextSinceSeq());

        PullResult next = service.pull(cid, first.getNextSinceSeq(), 2, 301L);
        assertEquals(List.of(3L, 4L),
                next.getMessages().stream().map(v -> v.getSeq()).toList());
        assertTrue(next.isHasMore());

        PullResult last = service.pull(cid, next.getNextSinceSeq(), 2, 301L);
        assertEquals(List.of(5L),
                last.getMessages().stream().map(v -> v.getSeq()).toList());
        assertFalse(last.isHasMore());
    }

    @Test
    void null_since_and_limit_use_defaults() {
        PullResult r = service.pull(cid, null, null, 301L);
        assertEquals(5, r.getMessages().size()); // 默认 limit 50，全量 5 条
        assertFalse(r.isHasMore());
    }
}
```

- [ ] **Step 5: 运行，确认失败**

Run: `mvn -q -pl backend -Dtest=MessageQueryServiceTest test`
Expected: 编译失败——`MessageQueryService` 不存在。

- [ ] **Step 6: 实现 `MessageQueryService.java`**

Create `backend/src/main/java/com/rbac/im/service/MessageQueryService.java`：

```java
package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.vo.ImMessageVO;
import com.rbac.im.vo.PullResult;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;

import java.util.List;

/** 单会话消息增量拉取：成员校验 + forward 分页。 */
@Service
public class MessageQueryService {

    private static final int DEFAULT_LIMIT = 50;
    private static final int MAX_LIMIT = 200;

    private final ImMessageRepository repo;
    private final ConversationService conversationService;

    public MessageQueryService(ImMessageRepository repo, ConversationService conversationService) {
        this.repo = repo;
        this.conversationService = conversationService;
    }

    public PullResult pull(String cid, Long sinceSeq, Integer limit, long requesterUserId) {
        if (!conversationService.isMember(cid, requesterUserId)) {
            throw new BusinessException(403, "im.conversation.notMember");
        }
        long since = sinceSeq == null ? 0L : sinceSeq;
        int size = normalizeLimit(limit);

        // 多取 1 条用于判断 hasMore
        List<ImMessage> rows = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, since, Limit.of(size + 1));
        boolean hasMore = rows.size() > size;
        List<ImMessage> page = hasMore ? rows.subList(0, size) : rows;

        List<ImMessageVO> messages = page.stream().map(this::toVo).toList();
        long nextSinceSeq = page.isEmpty() ? since : page.get(page.size() - 1).getSeq();

        PullResult result = new PullResult();
        result.setMessages(messages);
        result.setHasMore(hasMore);
        result.setNextSinceSeq(nextSinceSeq);
        return result;
    }

    private int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private ImMessageVO toVo(ImMessage m) {
        ImMessageVO vo = new ImMessageVO();
        vo.setCid(m.getCid());
        vo.setSeq(m.getSeq());
        vo.setMsgId(m.getMsgId());
        vo.setSenderId(m.getSenderId());
        vo.setType(m.getType());
        vo.setBody(m.getBody());
        vo.setRecalled(m.isRecalled());
        vo.setTs(m.getTs());
        return vo;
    }
}
```

- [ ] **Step 7: 运行测试**

Run: `mvn -q -pl backend -Dtest=MessageQueryServiceTest test`（需 MySQL + MongoDB）
Expected: PASS（4 个用例）。

- [ ] **Step 8: Commit**

```bash
git add backend/src/main/java/com/rbac/im/vo/ImMessageVO.java \
        backend/src/main/java/com/rbac/im/vo/PullResult.java \
        backend/src/main/java/com/rbac/im/service/MessageQueryService.java \
        backend/src/main/resources/i18n/messages.properties \
        backend/src/main/resources/i18n/messages_zh_CN.properties \
        backend/src/main/resources/i18n/messages_en_US.properties \
        backend/src/test/java/com/rbac/im/service/MessageQueryServiceTest.java
git commit -m "feat(im): 消息查询服务（成员校验+增量拉取+分页）与 i18n"
```

---

## Task 4: REST 控制器 + 端到端 MockMvc 测试

**Files:**
- Create: `backend/src/main/java/com/rbac/im/controller/ImConversationController.java`
- Create: `backend/src/main/java/com/rbac/im/controller/ImMessageController.java`
- Test: `backend/src/test/java/com/rbac/im/controller/ImApiMockMvcTest.java`

**Interfaces:**
- Consumes: `ConversationService.listMyConversations(long)`（Task 2）、`MessageQueryService.pull(String,Long,Integer,long)`（Task 3）、`SecurityUtils.getUserId()`、`Result.success(data)`。
- Produces:
  - `GET /api/im/conversations` → `Result<List<ImConversationVO>>`
  - `GET /api/im/messages?cid=&sinceSeq=&limit=` → `Result<PullResult>`

- [ ] **Step 1: 新建 `ImConversationController.java`**

Create `backend/src/main/java/com/rbac/im/controller/ImConversationController.java`：

```java
package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.service.ConversationService;
import com.rbac.im.vo.ImConversationVO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** IM 会话列表同步。 */
@RestController
@RequestMapping("/im")
public class ImConversationController {

    private final ConversationService conversationService;

    public ImConversationController(ConversationService conversationService) {
        this.conversationService = conversationService;
    }

    @GetMapping("/conversations")
    public Result<List<ImConversationVO>> conversations() {
        return Result.success(conversationService.listMyConversations(SecurityUtils.getUserId()));
    }
}
```

- [ ] **Step 2: 新建 `ImMessageController.java`**

Create `backend/src/main/java/com/rbac/im/controller/ImMessageController.java`：

```java
package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.service.MessageQueryService;
import com.rbac.im.vo.PullResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** IM 单会话增量拉取。 */
@RestController
@RequestMapping("/im")
public class ImMessageController {

    private final MessageQueryService messageQueryService;

    public ImMessageController(MessageQueryService messageQueryService) {
        this.messageQueryService = messageQueryService;
    }

    @GetMapping("/messages")
    public Result<PullResult> messages(@RequestParam String cid,
                                       @RequestParam(required = false) Long sinceSeq,
                                       @RequestParam(required = false) Integer limit) {
        return Result.success(messageQueryService.pull(cid, sinceSeq, limit, SecurityUtils.getUserId()));
    }
}
```

- [ ] **Step 3: 写端到端 MockMvc 测试**

Create `backend/src/test/java/com/rbac/im/controller/ImApiMockMvcTest.java`：

```java
package com.rbac.im.controller;

import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.service.ConversationService;
import com.rbac.security.model.LoginUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ImApiMockMvcTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ConversationService conversationService;
    @Autowired
    private ImMessageRepository repo;

    private String cid;

    private Authentication authAs(long userId) {
        LoginUser u = new LoginUser();
        u.setUserId(userId);
        u.setUsername("u" + userId);
        return new UsernamePasswordAuthenticationToken(u, null, List.of());
    }

    @BeforeEach
    void setup() {
        cid = conversationService.ensureSingleConversation(401, 402);
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L));
        for (long s = 1; s <= 3; s++) {
            ImMessage m = new ImMessage();
            m.setCid(cid);
            m.setSeq(s);
            m.setMsgId("m" + s);
            m.setSenderId(401L);
            m.setType("TEXT");
            m.setBody(Map.of("text", "t" + s));
            m.setClientMsgId("cli-" + s);
            m.setTs(System.currentTimeMillis());
            repo.save(m);
        }
    }

    @Test
    void member_pulls_messages() throws Exception {
        mockMvc.perform(get("/im/messages").param("cid", cid).param("sinceSeq", "0")
                        .with(authentication(authAs(401))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.messages.length()").value(3))
                .andExpect(jsonPath("$.data.hasMore").value(false));
    }

    @Test
    void non_member_gets_403_in_body() throws Exception {
        mockMvc.perform(get("/im/messages").param("cid", cid)
                        .with(authentication(authAs(999))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(403));
    }

    @Test
    void conversations_list_returns_my_conversation() throws Exception {
        mockMvc.perform(get("/im/conversations").with(authentication(authAs(401))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[?(@.cid=='" + cid + "')]").exists());
    }
}
```

> 说明：`JwtAuthenticationFilter` 只在「有 Bearer token 且上下文为空」时才设认证，无 token 时不清除已注入的认证；故 `spring-security-test` 的 `.with(authentication(...))` 注入的 `LoginUser` 会被 `SecurityUtils.getUserId()` 正确读取。`BusinessException(403)` 经 `GlobalExceptionHandler` 返回 HTTP 200 + body `code=403`。

- [ ] **Step 4: 运行测试**

Run: `mvn -q -pl backend -Dtest=ImApiMockMvcTest test`（需 MySQL + MongoDB + Redis）
Expected: PASS（3 个用例）。

- [ ] **Step 5: 整个 im 相关测试回归**

Run: `mvn -q -pl backend -Dtest='ImMessageRepositoryPageTest,ConversationServiceListTest,MessageQueryServiceTest,ImApiMockMvcTest' test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/rbac/im/controller/ImConversationController.java \
        backend/src/main/java/com/rbac/im/controller/ImMessageController.java \
        backend/src/test/java/com/rbac/im/controller/ImApiMockMvcTest.java
git commit -m "feat(im): 会话列表与增量拉取 REST 接口 + 端到端鉴权测试"
```

---

## 收尾

- [ ] **全部 Task 完成后**：里程碑 4（离线 + 多端同步）落地——`GET /api/im/conversations` 与 `GET /api/im/messages` 可用，成员校验强制、增量分页正确。
- [ ] 走 `superpowers:finishing-a-development-branch` 决定 `feat/im` 后续（继续下一里程碑 / 合入 / 开 PR）。
- [ ] 提醒用户：`backend/src/test/java/com/rbac/system/role/RoleServiceCacheEvictTest.java` 仍是未跟踪红灯（Phase 1 遗留 WIP，见记忆 `im-phase1-wip-stash`），跑 `mvn -pl backend test` 全量测试前需先处理它，否则会挡整体编译。本计划用 `-Dtest=` 定向跑，不受影响。
