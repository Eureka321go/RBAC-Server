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
import org.springframework.jdbc.core.JdbcTemplate;
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
    @Autowired JdbcTemplate jdbc;
    @MockBean OutboundDispatcher dispatcher;   // 拦截扇出，验证 ERROR 与丢弃

    final ObjectMapper om = new ObjectMapper();
    final String cid = "c_9101_9102";

    @BeforeEach
    void setup() {
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(1000)));
        // uk_cid / uk_cid_user 不含 deleted 列，MyBatis-Plus 的逻辑删除会导致第二次运行唯一键冲突，改为物理删除以保证可重复运行。
        jdbc.update("delete from im_conversation where cid = ?", cid);
        jdbc.update("delete from im_conversation_member where cid = ?", cid);
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
