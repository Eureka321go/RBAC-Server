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
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 端到端验证已读回执：会话 last_msg_seq=5（模拟 A 已发到 5），B 上报 op=READ readSeq=5 →
 * B 的 last_read_seq 推进到 5 且未读归 0；回执仅扇出给 A（排除阅读者 B）；
 * A 的会话列表可见对端已读位点 peerReadSeq=5（里程碑10）。
 */
@SpringBootTest
@ActiveProfiles("test")
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
