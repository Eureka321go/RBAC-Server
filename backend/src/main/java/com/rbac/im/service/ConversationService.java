package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.mapper.ImGroupMemberMapper;
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
    private final ImGroupMemberMapper groupMemberMapper;

    public ConversationService(ImConversationMapper conversationMapper,
                               ImConversationMemberMapper memberMapper,
                               ImGroupMemberMapper groupMemberMapper) {
        this.conversationMapper = conversationMapper;
        this.memberMapper = memberMapper;
        this.groupMemberMapper = groupMemberMapper;
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

    /** 建群会话（幂等）：插入 GROUP 会话 + 各成员会话位点行，返回 cid。 */
    @Transactional
    public String ensureGroupConversation(long groupId, java.util.List<Long> memberIds) {
        String cid = "g_" + groupId;
        ImConversation existing = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        if (existing == null) {
            ImConversation c = new ImConversation();
            c.setCid(cid);
            c.setType("GROUP");
            c.setGroupId(groupId);
            c.setLastMsgSeq(0L);
            conversationMapper.insert(c);
            for (Long uid : memberIds) {
                insertMember(cid, uid);
            }
        }
        return cid;
    }

    /** 加会话成员，last_read_seq 初始化为会话当前 last_msg_seq（新成员不背历史未读）。 */
    public void addConversationMember(String cid, long userId) {
        ImConversation c = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        long init = (c == null || c.getLastMsgSeq() == null) ? 0L : c.getLastMsgSeq();
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid);
        m.setUserId(userId);
        m.setLastReadSeq(init);
        m.setMentionSeq(0L);
        m.setMuted(0);
        memberMapper.insert(m);
    }

    public void removeConversationMember(String cid, long userId) {
        memberMapper.physicalDelete(cid, userId);
    }

    public void removeConversation(String cid) {
        memberMapper.delete(new LambdaQueryWrapper<ImConversationMember>()
                .eq(ImConversationMember::getCid, cid));
        conversationMapper.delete(new LambdaQueryWrapper<ImConversation>()
                .eq(ImConversation::getCid, cid));
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

    /** 会话当前 last_msg_seq；会话不存在或未初始化返回 0。用于已读位点钳制。 */
    public long lastMsgSeq(String cid) {
        ImConversation c = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        return (c == null || c.getLastMsgSeq() == null) ? 0L : c.getLastMsgSeq();
    }

    /** 从 cid 解析群 id；非群会话返回 null。 */
    public static Long groupIdFromCid(String cid) {
        return cid != null && cid.startsWith("g_") ? Long.valueOf(cid.substring(2)) : null;
    }

    /** 该用户在群会话内是否被禁言（单聊恒 false）。 */
    public boolean isGroupMuted(String cid, long userId) {
        Long gid = groupIdFromCid(cid);
        if (gid == null) {
            return false;
        }
        Long n = groupMemberMapper.selectCount(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, gid)
                .eq(ImGroupMember::getUserId, userId)
                .eq(ImGroupMember::getMuted, 1));
        return n != null && n > 0;
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
        Map<String, Long> mentionSeqByCid = members.stream()
                .collect(Collectors.toMap(ImConversationMember::getCid,
                        m -> m.getMentionSeq() == null ? 0L : m.getMentionSeq(),
                        (a, b) -> a));
        List<String> cids = members.stream().map(ImConversationMember::getCid).toList();
        List<ImConversation> convs = conversationMapper.selectList(
                new LambdaQueryWrapper<ImConversation>().in(ImConversation::getCid, cids));
        return convs.stream().map(c -> {
            long lastMsgSeq = c.getLastMsgSeq() == null ? 0L : c.getLastMsgSeq();
            long lastReadSeq = readSeqByCid.getOrDefault(c.getCid(), 0L);
            long mentionSeq = mentionSeqByCid.getOrDefault(c.getCid(), 0L);
            ImConversationVO vo = new ImConversationVO();
            vo.setCid(c.getCid());
            vo.setType(c.getType());
            vo.setGroupId(c.getGroupId());
            vo.setLastMsgSeq(lastMsgSeq);
            vo.setLastMsgPreview(c.getLastMsgPreview());
            vo.setLastReadSeq(lastReadSeq);
            vo.setUnreadCount(Math.max(0L, lastMsgSeq - lastReadSeq));
            vo.setMentionSeq(mentionSeq);
            vo.setHasMention(mentionSeq > lastReadSeq);
            return vo;
        }).toList();
    }
}
