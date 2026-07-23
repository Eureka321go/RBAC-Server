package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ConversationService {

    private final ImConversationMapper conversationMapper;
    private final ImConversationMemberMapper memberMapper;

    public ConversationService(ImConversationMapper conversationMapper,
                               ImConversationMemberMapper memberMapper) {
        this.conversationMapper = conversationMapper;
        this.memberMapper = memberMapper;
    }

    public String singleCid(long a, long b) {
        long min = Math.min(a, b);
        long max = Math.max(a, b);
        return "c_" + min + "_" + max;
    }

    @Transactional
    public String ensureSingleConversation(long a, long b) {
        String cid = singleCid(a, b);
        ImConversation existing = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        if (existing == null) {
            ImConversation c = new ImConversation();
            c.setCid(cid);
            c.setType("SINGLE");
            c.setLastMsgSeq(0L);
            conversationMapper.insert(c);
            insertMember(cid, a);
            insertMember(cid, b);
        }
        return cid;
    }

    private void insertMember(String cid, long userId) {
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid);
        m.setUserId(userId);
        m.setLastReadSeq(0L);
        m.setMentionSeq(0L);
        m.setMuted(0);
        memberMapper.insert(m);
    }

    public List<Long> memberUserIds(String cid) {
        return memberMapper.selectList(
                        new LambdaQueryWrapper<ImConversationMember>().eq(ImConversationMember::getCid, cid))
                .stream().map(ImConversationMember::getUserId).toList();
    }
}
