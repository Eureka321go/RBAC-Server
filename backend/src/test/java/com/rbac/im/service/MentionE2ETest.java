package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.CreateGroupResult;
import com.rbac.im.vo.ImConversationVO;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

/**
 * 端到端验证 @提及：
 *  A) 群管理员 @所有人 → 各成员（除发送者）mention_seq=该消息 seq，会话列表 hasMention=true；
 *  B) 普通成员 @所有人（mention-all-admin-only=true）→ 整条拒绝回 ERROR(MENTION_ALL_FORBIDDEN)、不落库；
 *  C) @非会话成员 → 整条拒绝回 ERROR(MENTION_NOT_MEMBER)。
 */
@SpringBootTest
@ActiveProfiles("test")
class MentionE2ETest {

    @Autowired GroupService groupService;
    @Autowired ConversationService conversationService;
    @Autowired InboundMessageConsumer consumer;
    @Autowired ImMessageRepository repo;
    @Autowired ImConversationMemberMapper memberMapper;
    @MockBean OutboundDispatcher dispatcher;   // 拦截扇出

    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final long OWNER_ID = 6501L;
    private static final long MEMBER1 = 6502L;
    private static final long MEMBER2 = 6503L;
    private static final long OUTSIDER = 6599L;

    private long mentionSeqOf(String cid, long userId) {
        ImConversationMember m = memberMapper.selectOne(new LambdaQueryWrapper<ImConversationMember>()
                .eq(ImConversationMember::getCid, cid)
                .eq(ImConversationMember::getUserId, userId));
        return m.getMentionSeq() == null ? 0L : m.getMentionSeq();
    }

    private void send(String cid, long sender, Map<String, Object> body, String clientMsgId) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND");
        e.setCid(cid);
        e.setSenderId(sender);
        e.setType("TEXT");
        e.setBody(body);
        e.setClientMsgId(clientMsgId);
        consumer.onMessage(objectMapper.writeValueAsString(e));
    }

    @Test
    void managerMentionAll_advancesMentionSeq_andSurfacesMarker() throws Exception {
        String runId = UUID.randomUUID().toString();
        CreateGroupResult r = groupService.createGroup(OWNER_ID, "提及群", List.of(MEMBER1, MEMBER2));
        String cid = r.getCid();

        send(cid, OWNER_ID, Map.of("text", "大家看", "mentionAll", true), "cm-all-" + runId);

        // 拿刚发的 TEXT seq
        List<ImMessage> msgs = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(100));
        long seq = msgs.stream()
                .filter(m -> "TEXT".equals(m.getType()) && OWNER_ID == m.getSenderId())
                .mapToLong(ImMessage::getSeq).max().orElseThrow();

        // 成员被打标，发送者本人不打标
        assertThat(mentionSeqOf(cid, MEMBER1)).isEqualTo(seq);
        assertThat(mentionSeqOf(cid, MEMBER2)).isEqualTo(seq);
        assertThat(mentionSeqOf(cid, OWNER_ID)).isEqualTo(0L);

        // 成员会话列表出现"有人@我"
        ImConversationVO vo = conversationService.listMyConversations(MEMBER1).stream()
                .filter(v -> v.getCid().equals(cid)).findFirst().orElseThrow();
        assertThat(vo.isHasMention()).isTrue();
        assertThat(vo.getMentionSeq()).isEqualTo(seq);
    }

    @Test
    void memberMentionAll_rejectedWithError_andNotPersisted() throws Exception {
        String runId = UUID.randomUUID().toString();
        CreateGroupResult r = groupService.createGroup(OWNER_ID, "提及群2", List.of(MEMBER1, MEMBER2));
        String cid = r.getCid();

        send(cid, MEMBER1, Map.of("text", "全体注意", "mentionAll", true), "cm-mem-" + runId);

        ArgumentCaptor<Envelope> cap = ArgumentCaptor.forClass(Envelope.class);
        verify(dispatcher).dispatchToUser(eq(MEMBER1), cap.capture());
        assertThat(cap.getValue().getOp()).isEqualTo("ERROR");
        assertThat(cap.getValue().getBody().get("reason")).isEqualTo("MENTION_ALL_FORBIDDEN");
        // 未落库：无该成员发的 TEXT，且未打标
        assertThat(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(100)).stream()
                .noneMatch(m -> "TEXT".equals(m.getType()) && MEMBER1 == m.getSenderId())).isTrue();
        assertThat(mentionSeqOf(cid, MEMBER2)).isEqualTo(0L);
    }

    @Test
    void mentionNonMember_rejectedWithError() throws Exception {
        String runId = UUID.randomUUID().toString();
        CreateGroupResult r = groupService.createGroup(OWNER_ID, "提及群3", List.of(MEMBER1, MEMBER2));
        String cid = r.getCid();

        send(cid, OWNER_ID, Map.of("text", "喂", "mentions", List.of(MEMBER1, OUTSIDER)), "cm-nom-" + runId);

        ArgumentCaptor<Envelope> cap = ArgumentCaptor.forClass(Envelope.class);
        verify(dispatcher).dispatchToUser(eq(OWNER_ID), cap.capture());
        assertThat(cap.getValue().getOp()).isEqualTo("ERROR");
        assertThat(cap.getValue().getBody().get("reason")).isEqualTo("MENTION_NOT_MEMBER");
        assertThat(mentionSeqOf(cid, MEMBER1)).isEqualTo(0L);
    }
}
