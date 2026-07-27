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
