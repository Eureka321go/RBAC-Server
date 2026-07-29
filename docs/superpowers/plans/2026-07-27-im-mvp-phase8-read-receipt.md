# 里程碑10 已读未读/已读回执 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户端上报已读位点 → 前向单调推进 `last_read_seq` → 单聊向对端扇出已读回执；会话 VO 暴露 `peerReadSeq` 保证重连一致。

**Architecture:** 复用 Kafka `im-inbound` 的 op 分支（同 RECALL）：`InboundMessageConsumer` 遇 `op=READ` 路由到新 `ReadService`。ReadService 校验成员、钳制到 `last_msg_seq`、前向推进 `last_read_seq`；仅单聊且确实推进时向对端 `dispatchToUser` 一帧 `op=READ`。`ConversationService.listMyConversations` 为单聊填 `peerReadSeq`。

**Tech Stack:** Java 21 + Spring Boot 3.4.1 + MyBatis-Plus + Mockito 单测（无 Spring 上下文，同 RecallServiceTest）。

## Global Constraints

- 分支 `feat/im`，Base `b101dd7`。
- API camelCase；枚举字符串常量。
- 硬编码 id 的测试清理用**物理删除**（`uk_cid_user` 不含 deleted，软删后同键再插撞 DuplicateKey）。
- READ 帧**不落库、不占 seq**，不走幂等/媒体/@提及校验链。
- 群聊只推进不扇出；单聊才扇出回执。回执排除阅读者本人。
- 提交尾注：`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01PhwtB8L5XG37b1BXGFpkQ3`。

---

### Task 1: ReadService（推进 + 钳制 + 成员校验 + 单聊扇出）

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/ReadService.java`
- Modify: `backend/src/main/java/com/rbac/im/mapper/ImConversationMemberMapper.java`（加 `advanceReadSeq`）
- Modify: `backend/src/main/java/com/rbac/im/service/ConversationService.java`（加 `lastMsgSeq(cid)`）
- Test: `backend/src/test/java/com/rbac/im/service/ReadServiceTest.java`

**Interfaces:**
- Consumes: `ConversationService.isMember(String,long)`、`ConversationService.memberUserIds(String)`、`ConversationService.groupIdFromCid(String)`（static）、`OutboundDispatcher.dispatchToUser(long,Envelope)`。
- Produces: `ReadService.read(Envelope)`（Task 2 调用）；`ConversationService.lastMsgSeq(String cid) -> long`；`ImConversationMemberMapper.advanceReadSeq(String cid,long userId,long seq) -> int`。

- [ ] **Step 1: 写失败测试** `ReadServiceTest.java`

```java
package com.rbac.im.service;

import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ReadServiceTest {

    private final ConversationService conv = mock(ConversationService.class);
    private final ImConversationMemberMapper memberMapper = mock(ImConversationMemberMapper.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);

    private final ReadService svc = new ReadService(conv, memberMapper, dispatcher);

    private Envelope readEnv(String cid, long readerId, Object readSeq) {
        Envelope e = new Envelope();
        e.setOp("READ");
        e.setCid(cid);
        e.setSenderId(readerId);
        e.setBody(readSeq == null ? Map.of() : Map.of("readSeq", readSeq));
        return e;
    }

    @Test
    void single_chat_advances_and_fans_out_to_peer_excluding_reader() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);
        when(conv.lastMsgSeq("c_1_2")).thenReturn(5L);
        when(memberMapper.advanceReadSeq("c_1_2", 2L, 5L)).thenReturn(1);
        when(conv.memberUserIds("c_1_2")).thenReturn(List.of(1L, 2L));

        svc.read(readEnv("c_1_2", 2L, 5L));

        verify(memberMapper).advanceReadSeq("c_1_2", 2L, 5L);
        // 回执只发给对端 1，不发给阅读者 2
        verify(dispatcher).dispatchToUser(eq(1L), argThat(env ->
                "READ".equals(env.getOp()) && "c_1_2".equals(env.getCid())
                        && env.getSenderId() == 2L
                        && Long.valueOf(5L).equals(((Number) env.getBody().get("readSeq")).longValue())));
        verify(dispatcher, never()).dispatchToUser(eq(2L), any());
    }

    @Test
    void clamps_readSeq_to_last_msg_seq() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);
        when(conv.lastMsgSeq("c_1_2")).thenReturn(5L);
        when(memberMapper.advanceReadSeq("c_1_2", 2L, 5L)).thenReturn(1);
        when(conv.memberUserIds("c_1_2")).thenReturn(List.of(1L, 2L));

        svc.read(readEnv("c_1_2", 2L, 999L)); // 上报超大 seq

        verify(memberMapper).advanceReadSeq("c_1_2", 2L, 5L); // 钳制到 5
    }

    @Test
    void stale_report_not_advanced_no_fanout() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);
        when(conv.lastMsgSeq("c_1_2")).thenReturn(5L);
        when(memberMapper.advanceReadSeq("c_1_2", 2L, 3L)).thenReturn(0); // 未推进

        svc.read(readEnv("c_1_2", 2L, 3L));

        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }

    @Test
    void group_chat_advances_but_no_fanout() {
        when(conv.isMember("g_10", 2L)).thenReturn(true);
        when(conv.lastMsgSeq("g_10")).thenReturn(5L);
        when(memberMapper.advanceReadSeq("g_10", 2L, 5L)).thenReturn(1);

        svc.read(readEnv("g_10", 2L, 5L));

        verify(memberMapper).advanceReadSeq("g_10", 2L, 5L);
        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }

    @Test
    void non_member_noop() {
        when(conv.isMember("c_1_2", 9L)).thenReturn(false);

        svc.read(readEnv("c_1_2", 9L, 5L));

        verify(memberMapper, never()).advanceReadSeq(anyString(), anyLong(), anyLong());
        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }

    @Test
    void missing_or_invalid_readSeq_noop() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);

        svc.read(readEnv("c_1_2", 2L, null));            // 缺失
        svc.read(readEnv("c_1_2", 2L, "notNumber"));     // 非数字

        verify(memberMapper, never()).advanceReadSeq(anyString(), anyLong(), anyLong());
        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=ReadServiceTest`
Expected: 编译失败（`ReadService` / `advanceReadSeq` / `lastMsgSeq` 未定义）。

- [ ] **Step 3: 加 mapper 方法** —— 在 `ImConversationMemberMapper` 追加：

```java
    /**
     * 里程碑10：把该成员 last_read_seq 前向推进到 #{seq}（只增不减，天然幂等）。
     * 返回受影响行数：0 表示未推进（重复/过期上报），调用方据此决定是否扇出回执。
     */
    @Update("UPDATE im_conversation_member SET last_read_seq = #{seq} "
            + "WHERE cid = #{cid} AND user_id = #{userId} AND last_read_seq < #{seq}")
    int advanceReadSeq(@Param("cid") String cid,
                       @Param("userId") long userId,
                       @Param("seq") long seq);
```

（`@Update` / `@Param` 已 import；`@Param` 全限定或已有 import 均可，跟文件现状一致。）

- [ ] **Step 4: 加 `ConversationService.lastMsgSeq`** —— 在 `ConversationService` 追加：

```java
    /** 会话当前 last_msg_seq；会话不存在或未初始化返回 0。用于已读位点钳制。 */
    public long lastMsgSeq(String cid) {
        ImConversation c = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        return (c == null || c.getLastMsgSeq() == null) ? 0L : c.getLastMsgSeq();
    }
```

- [ ] **Step 5: 写 `ReadService`**

```java
package com.rbac.im.service;

import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 里程碑10：已读上报。op=READ 帧不落库、不占 seq。
 * 校验成员 → 钳制到 last_msg_seq → 前向单调推进 last_read_seq；
 * 仅单聊且确实推进时向对端（排除阅读者）扇出 op=READ 回执。群聊只推进不扇出。
 */
@Service
public class ReadService {

    private final ConversationService conversationService;
    private final ImConversationMemberMapper memberMapper;
    private final OutboundDispatcher dispatcher;

    public ReadService(ConversationService conversationService,
                       ImConversationMemberMapper memberMapper,
                       OutboundDispatcher dispatcher) {
        this.conversationService = conversationService;
        this.memberMapper = memberMapper;
        this.dispatcher = dispatcher;
    }

    public void read(Envelope env) {
        String cid = env.getCid();
        long readerId = env.getSenderId();

        // 1) 成员校验：被动阅读，非成员静默返回（不回 ERROR）
        if (!conversationService.isMember(cid, readerId)) {
            return;
        }

        // 2) 解析 readSeq：缺失/非数字 → no-op
        Object raw = env.getBody() == null ? null : env.getBody().get("readSeq");
        if (!(raw instanceof Number n)) {
            return;
        }

        // 3) 钳制到会话 last_msg_seq，防止上报超大 seq 把未来消息永久标记已读
        long effective = Math.min(n.longValue(), conversationService.lastMsgSeq(cid));

        // 4) 前向单调推进
        int rows = memberMapper.advanceReadSeq(cid, readerId, effective);
        if (rows == 0) {
            return; // 未推进（重复/过期上报）→ 不扇出
        }

        // 5) 仅单聊扇出回执给对端（排除阅读者）
        if (ConversationService.groupIdFromCid(cid) != null) {
            return; // 群聊只推进不扇出
        }
        Envelope receipt = new Envelope();
        receipt.setOp("READ");
        receipt.setCid(cid);
        receipt.setSenderId(readerId);
        receipt.setBody(Map.of("readSeq", effective));
        for (Long uid : conversationService.memberUserIds(cid)) {
            if (uid != readerId) {
                dispatcher.dispatchToUser(uid, receipt);
            }
        }
    }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=ReadServiceTest`
Expected: 6 tests PASS。

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/ReadService.java \
        backend/src/main/java/com/rbac/im/mapper/ImConversationMemberMapper.java \
        backend/src/main/java/com/rbac/im/service/ConversationService.java \
        backend/src/test/java/com/rbac/im/service/ReadServiceTest.java
git commit -m "feat(im): ReadService 已读上报 校验+钳制+前向推进 last_read_seq，单聊扇出回执"
```

---

### Task 2: InboundMessageConsumer 接线 op=READ

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`
- Test: `backend/src/test/java/com/rbac/im/service/InboundReadTriggerTest.java`（新建）

**Interfaces:**
- Consumes: `ReadService.read(Envelope)`（Task 1）；`InboundMessageConsumer` 构造需新增 `ReadService` 依赖。
- Produces: op=READ 进入消费者即路由 `readService.read` 并 return（不 append）。

- [ ] **Step 1: 写失败测试** `InboundReadTriggerTest.java`

参考同目录 `InboundMentionTriggerTest` 的构造方式（mock 全部依赖）。构造器新增 `ReadService` 参数——先看 `InboundMentionTriggerTest` 现有构造实参顺序，把 `readService` mock 按新签名补入。

```java
package com.rbac.im.service;

import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class InboundReadTriggerTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final MessageAppender appender = mock(MessageAppender.class);
    private final ConversationService conv = mock(ConversationService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);
    private final MediaService media = mock(MediaService.class);
    private final LinkPreviewService link = mock(LinkPreviewService.class);
    private final RecallService recall = mock(RecallService.class);
    private final MentionService mention = mock(MentionService.class);
    private final ReadService read = mock(ReadService.class);

    private final InboundMessageConsumer consumer = new InboundMessageConsumer(
            repo, appender, conv, dispatcher, media, link, recall, mention, read);

    @Test
    void read_op_routes_to_readService_and_does_not_append() throws Exception {
        Envelope env = new Envelope();
        env.setOp("READ");
        env.setCid("c_1_2");
        env.setSenderId(2L);
        env.setBody(Map.of("readSeq", 5L));

        consumer.onMessage(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(env));

        verify(read).read(argThat(e -> "READ".equals(e.getOp())
                && "c_1_2".equals(e.getCid()) && e.getSenderId() == 2L));
        verify(appender, never()).append(anyString(), anyLong(), anyString(), any(), any());
        verify(recall, never()).recall(any());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=InboundReadTriggerTest`
Expected: 编译失败（构造器无 `ReadService` 参数）。

- [ ] **Step 3: 接线** —— `InboundMessageConsumer`：构造新增 `ReadService readService` 字段+参数+赋值（追加到参数列表末尾、`mentionService` 之后）；在 `RECALL` 分支之后、幂等判断之前加：

```java
        // 里程碑10：已读上报走独立分支（不落库、不占 seq、不走幂等/媒体/@提及校验链）
        if ("READ".equals(env.getOp())) {
            readService.read(env);
            return;
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=InboundReadTriggerTest`
Expected: PASS。若其它引用旧构造器的测试编译失败，同步补 `ReadService` mock 实参。

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java \
        backend/src/test/java/com/rbac/im/service/InboundReadTriggerTest.java
git commit -m "feat(im): InboundMessageConsumer 接线 op=READ 分支路由 ReadService"
```

---

### Task 3: ConversationVO.peerReadSeq（仅单聊）

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/vo/ImConversationVO.java`（加 `Long peerReadSeq`）
- Modify: `backend/src/main/java/com/rbac/im/service/ConversationService.java:145-179`（`listMyConversations` 填 `peerReadSeq`）
- Test: `backend/src/test/java/com/rbac/im/service/ConversationServicePeerReadTest.java`（新建，DB 集成，物理删除清理）

**Interfaces:**
- Consumes: `ConversationService.listMyConversations(long)`。
- Produces: `ImConversationVO.getPeerReadSeq() -> Long`（单聊=对端 last_read_seq；群聊=null）。

- [ ] **Step 1: 加 VO 字段** —— `ImConversationVO` 追加：

```java
    private Long peerReadSeq;     // 里程碑10：单聊对端已读位点；群聊/无对端为 null
```

（Lombok `@Data` 自动生成 getter/setter，与现有字段一致。）

- [ ] **Step 2: 写失败测试** `ConversationServicePeerReadTest.java`

参考同目录 `ConversationServiceListTest` 的 Spring 集成风格（`@SpringBootTest` + `@Autowired ConversationService` + mapper 直接造数 + `@BeforeEach` 物理删除清理）。测试：单聊两成员，对端 last_read_seq=3 → 我方 VO.peerReadSeq==3；再建一个群会话 → 该 VO.peerReadSeq==null。

```java
package com.rbac.im.service;

import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.vo.ImConversationVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class ConversationServicePeerReadTest {

    @Autowired ConversationService svc;
    @Autowired ImConversationMapper convMapper;
    @Autowired ImConversationMemberMapper memberMapper;
    @Autowired JdbcTemplate jdbc;

    private static final String SINGLE = "c_9001_9002";
    private static final String GROUP = "g_9003";

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM im_conversation_member WHERE cid IN (?,?)", SINGLE, GROUP);
        jdbc.update("DELETE FROM im_conversation WHERE cid IN (?,?)", SINGLE, GROUP);
    }

    private void conv(String cid, String type, Long groupId, long lastMsgSeq) {
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType(type); c.setGroupId(groupId); c.setLastMsgSeq(lastMsgSeq);
        convMapper.insert(c);
    }

    private void member(String cid, long userId, long lastReadSeq) {
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid); m.setUserId(userId); m.setLastReadSeq(lastReadSeq);
        m.setMentionSeq(0L); m.setMuted(0);
        memberMapper.insert(m);
    }

    @Test
    void single_conversation_vo_carries_peer_last_read_seq_group_is_null() {
        conv(SINGLE, "SINGLE", null, 5L);
        member(SINGLE, 9001L, 5L);   // me
        member(SINGLE, 9002L, 3L);   // peer read to 3
        conv(GROUP, "GROUP", 9003L, 8L);
        member(GROUP, 9001L, 2L);    // me
        member(GROUP, 9999L, 7L);    // other group member

        List<ImConversationVO> vos = svc.listMyConversations(9001L);

        ImConversationVO single = vos.stream().filter(v -> SINGLE.equals(v.getCid())).findFirst().orElseThrow();
        ImConversationVO group = vos.stream().filter(v -> GROUP.equals(v.getCid())).findFirst().orElseThrow();
        assertThat(single.getPeerReadSeq()).isEqualTo(3L);
        assertThat(group.getPeerReadSeq()).isNull();
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `mvn -f backend/pom.xml test -Dtest=ConversationServicePeerReadTest`
Expected: FAIL（`peerReadSeq` 恒 null / getter 不存在→若 VO 字段已加则断言 3L 失败）。

- [ ] **Step 4: 实现 peerReadSeq 填充** —— `listMyConversations` 内，在 `convs` 查出后、`return convs.stream().map(...)` 之前插入单聊对端已读映射：

```java
        List<String> singleCids = convs.stream()
                .filter(c -> "SINGLE".equals(c.getType()))
                .map(ImConversation::getCid).toList();
        Map<String, Long> peerReadByCid = singleCids.isEmpty() ? Map.of()
                : memberMapper.selectList(new LambdaQueryWrapper<ImConversationMember>()
                        .in(ImConversationMember::getCid, singleCids)
                        .ne(ImConversationMember::getUserId, userId))
                    .stream()
                    .collect(Collectors.toMap(ImConversationMember::getCid,
                            m -> m.getLastReadSeq() == null ? 0L : m.getLastReadSeq(),
                            (a, b) -> a));
```

然后在 `map` 内单聊分支设置（群聊留 null）：

```java
            if ("SINGLE".equals(c.getType())) {
                vo.setPeerReadSeq(peerReadByCid.getOrDefault(c.getCid(), 0L));
            }
```

（`Map`、`Collectors`、`LambdaQueryWrapper` 已 import。）

- [ ] **Step 5: 跑测试确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=ConversationServicePeerReadTest`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/rbac/im/vo/ImConversationVO.java \
        backend/src/main/java/com/rbac/im/service/ConversationService.java \
        backend/src/test/java/com/rbac/im/service/ConversationServicePeerReadTest.java
git commit -m "feat(im): ImConversationVO 暴露 peerReadSeq，会话列表为单聊填对端已读位点"
```

---

### Task 4: 端到端 + 全量回归 + 收尾

**Files:**
- Test: `backend/src/test/java/com/rbac/im/service/ReadReceiptE2ETest.java`（新建，DB 集成，mock dispatcher 断言回执）
- Modify: `docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md`（里程碑10 标注完成）
- Modify: `.superpowers/sdd/progress.md`（第八阶段台账）

**Interfaces:**
- Consumes: `ReadService.read`、`ConversationService.listMyConversations`、`ImConversationMemberMapper`。

- [ ] **Step 1: 写端到端测试** `ReadReceiptE2ETest.java`

`@SpringBootTest`，`@MockBean OutboundDispatcher`（断言回执扇出，避开真 Kafka），真库造单聊会话+成员。流程：会话 last_msg_seq=5（模拟 A 发到 seq5）；B（对端）`ReadService.read(readSeq=5)` → 断言 (1) B 的 member.last_read_seq==5、B 的 listMyConversations 未读==0；(2) `dispatcher.dispatchToUser(A, op=READ body.readSeq=5)` 被调用一次、未对 B 调用；(3) A 的 listMyConversations 该单聊 VO.peerReadSeq==5。

```java
package com.rbac.im.service;

import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.ImConversationVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest
class ReadReceiptE2ETest {

    @Autowired ReadService readService;
    @Autowired ConversationService conversationService;
    @Autowired ImConversationMapper convMapper;
    @Autowired ImConversationMemberMapper memberMapper;
    @Autowired JdbcTemplate jdbc;
    @MockBean OutboundDispatcher dispatcher;

    private static final long A = 9101L, B = 9102L;
    private static final String CID = "c_9101_9102";

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM im_conversation_member WHERE cid = ?", CID);
        jdbc.update("DELETE FROM im_conversation WHERE cid = ?", CID);
        ImConversation c = new ImConversation();
        c.setCid(CID); c.setType("SINGLE"); c.setLastMsgSeq(5L);
        convMapper.insert(c);
        insertMember(A, 5L); // A 已读到自己发的 5
        insertMember(B, 0L); // B 未读
    }

    private void insertMember(long uid, long lastRead) {
        ImConversationMember m = new ImConversationMember();
        m.setCid(CID); m.setUserId(uid); m.setLastReadSeq(lastRead);
        m.setMentionSeq(0L); m.setMuted(0);
        memberMapper.insert(m);
    }

    @Test
    void B_reports_read_advances_and_fans_receipt_to_A_and_A_sees_peerReadSeq() {
        Envelope env = new Envelope();
        env.setOp("READ"); env.setCid(CID); env.setSenderId(B);
        env.setBody(Map.of("readSeq", 5L));

        readService.read(env);

        // (1) B 已读推进 + 未读归 0
        List<ImConversationVO> bVos = conversationService.listMyConversations(B);
        ImConversationVO bVo = bVos.stream().filter(v -> CID.equals(v.getCid())).findFirst().orElseThrow();
        assertThat(bVo.getLastReadSeq()).isEqualTo(5L);
        assertThat(bVo.getUnreadCount()).isZero();

        // (2) 回执扇出给 A，不给 B
        verify(dispatcher).dispatchToUser(eq(A), argThat(e ->
                "READ".equals(e.getOp()) && CID.equals(e.getCid())
                        && ((Number) e.getBody().get("readSeq")).longValue() == 5L));
        verify(dispatcher, never()).dispatchToUser(eq(B), any());

        // (3) A 会话列表看到对端已读位点
        List<ImConversationVO> aVos = conversationService.listMyConversations(A);
        ImConversationVO aVo = aVos.stream().filter(v -> CID.equals(v.getCid())).findFirst().orElseThrow();
        assertThat(aVo.getPeerReadSeq()).isEqualTo(5L);
    }
}
```

- [ ] **Step 2: 跑端到端确认通过**

Run: `mvn -f backend/pom.xml test -Dtest=ReadReceiptE2ETest`
Expected: PASS。

- [ ] **Step 3: 全量回归**

Run: `mvn -f backend/pom.xml test -Dtest='com.rbac.im.**'`
Expected: 全绿（含既有 183 + 本期新增 ~9）。若数字回退查因。
再跑 `mvn -f backend/pom.xml package`（含全量非 IM），Expected: BUILD SUCCESS。

- [ ] **Step 4: 标注里程碑完成** —— `docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` 里程碑列表第 10 项后追加：`✅ 已完成（feat/im，Phase 8）——op=READ 复用 im-inbound；ReadService 成员校验+钳制到 last_msg_seq+前向单调推进 last_read_seq；单聊推进后向对端扇出 op=READ 回执（排除阅读者），群聊只推进不扇出；ImConversationVO 暴露 peerReadSeq（仅单聊）保证重连一致。`

- [ ] **Step 5: 更新进度台账** —— `.superpowers/sdd/progress.md` 顶部加第八阶段段落（Plan/Branch/Base + Task1-4 完成记录 + 全量绿数字）。

- [ ] **Step 6: 提交收尾**

```bash
git add backend/src/test/java/com/rbac/im/service/ReadReceiptE2ETest.java \
        docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md \
        .superpowers/sdd/progress.md
git commit -m "test(im): 已读回执端到端 + 里程碑10 标注完成 + 进度台账第八阶段"
```

---

## Self-Review

- **Spec coverage**：决策1（群聊不扇出/单聊扇出）→ Task1 Step5 + Task4 断言；决策2（op=READ 复用 im-inbound）→ Task2；决策3（peerReadSeq 仅单聊）→ Task3 + Task4。钳制防御→ Task1 clamp 用例。前向单调幂等→ Task1 stale 用例。✅ 全覆盖。
- **Placeholder scan**：无占位符，各步均含完整可粘贴代码/命令。
- **Type consistency**：`advanceReadSeq(String,long,long)->int`、`lastMsgSeq(String)->long`、`ReadService.read(Envelope)`、`peerReadSeq:Long` 在 Task1-4 一致；`InboundMessageConsumer` 构造参数顺序 `(repo,appender,conv,dispatcher,media,link,recall,mention,read)` Task2 测试与接线一致。
