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

    @Test
    void list_surfaces_mention_marker() {
        String cid = service.ensureSingleConversation(301, 302);
        ImConversationMember m = memberMapper.selectOne(
                new LambdaQueryWrapper<ImConversationMember>()
                        .eq(ImConversationMember::getCid, cid)
                        .eq(ImConversationMember::getUserId, 301L));
        m.setLastReadSeq(3L);
        m.setMentionSeq(7L);   // 被 @ 在 seq=7，尚未读到 → hasMention
        memberMapper.updateById(m);

        ImConversationVO vo = service.listMyConversations(301).stream()
                .filter(v -> v.getCid().equals(cid)).findFirst().orElseThrow();
        assertEquals(7L, vo.getMentionSeq());
        assertTrue(vo.isHasMention());

        // 读到越过 mention_seq → 标记消除
        m.setLastReadSeq(7L);
        memberMapper.updateById(m);
        ImConversationVO vo2 = service.listMyConversations(301).stream()
                .filter(v -> v.getCid().equals(cid)).findFirst().orElseThrow();
        assertEquals(7L, vo2.getMentionSeq());
        assertFalse(vo2.isHasMention());
    }
}
