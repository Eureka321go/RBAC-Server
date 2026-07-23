package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.vo.ImConversationVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

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
}
