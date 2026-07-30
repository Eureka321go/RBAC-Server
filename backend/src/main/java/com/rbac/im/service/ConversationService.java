package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.ImConversationVO;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class ConversationService {

    private final ImConversationMapper conversationMapper;
    private final ImConversationMemberMapper memberMapper;
    private final ImGroupMemberMapper groupMemberMapper;
    private final SysUserMapper userMapper;

    public ConversationService(ImConversationMapper conversationMapper,
                               ImConversationMemberMapper memberMapper,
                               ImGroupMemberMapper groupMemberMapper,
                               SysUserMapper userMapper) {
        this.conversationMapper = conversationMapper;
        this.memberMapper = memberMapper;
        this.groupMemberMapper = groupMemberMapper;
        this.userMapper = userMapper;
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

    /** 更新当前用户自己的会话免打扰设置。 */
    @Transactional
    public void setMuted(long userId, String cid, boolean muted) {
        ImConversationMember member = memberMapper.selectOne(
                new LambdaQueryWrapper<ImConversationMember>()
                        .eq(ImConversationMember::getCid, cid)
                        .eq(ImConversationMember::getUserId, userId));
        if (member == null) {
            throw new BusinessException(403, "im.conversation.notMember");
        }
        member.setMuted(muted ? 1 : 0);
        memberMapper.updateById(member);
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

    /**
     * 当前用户参与的会话列表（含未读数）。
     *
     * <p>未读数 = 会话最新消息序号 lastMsgSeq - 我的已读水位 lastReadSeq；
     * 单聊额外带出对端的已读水位（用于「已读/未读」回执）与对端昵称。
     *
     * <p>查询按「批量 + 内存聚合」组织，全流程固定 3 次 DB 查询（我的成员行、
     * 会话行、单聊对端成员行 + 对端用户），避免按会话逐条查询的 N+1。
     */
    public List<ImConversationVO> listMyConversations(long userId) {
        // 1. 我参与的所有会话成员行：既给出会话范围（cid 列表），也给出我的已读/@水位
        List<ImConversationMember> members = memberMapper.selectList(
                new LambdaQueryWrapper<ImConversationMember>()
                        .eq(ImConversationMember::getUserId, userId));
        if (members.isEmpty()) {
            return List.of();
        }
        // cid -> 我的已读水位（null 视为 0，即一条都没读过）
        Map<String, Long> readSeqByCid = members.stream()
                .collect(Collectors.toMap(ImConversationMember::getCid,
                        m -> m.getLastReadSeq() == null ? 0L : m.getLastReadSeq(),
                        (a, b) -> a));
        // cid -> 最近一次 @我 的消息序号（用于「有人@我」红点）
        Map<String, Long> mentionSeqByCid = members.stream()
                .collect(Collectors.toMap(ImConversationMember::getCid,
                        m -> m.getMentionSeq() == null ? 0L : m.getMentionSeq(),
                        (a, b) -> a));
        Map<String, Boolean> mutedByCid = members.stream()
                .collect(Collectors.toMap(ImConversationMember::getCid,
                        m -> Integer.valueOf(1).equals(m.getMuted()),
                        (a, b) -> a));
        // 2. 批量取会话本体（类型、群 id、最新消息序号与预览）
        List<String> cids = members.stream().map(ImConversationMember::getCid).toList();
        List<ImConversation> convs = conversationMapper.selectList(
                new LambdaQueryWrapper<ImConversation>().in(ImConversation::getCid, cids));
        // 3. 只有单聊才需要对端信息，先筛出单聊 cid
        List<String> singleCids = convs.stream()
                .filter(c -> "SINGLE".equals(c.getType()))
                .map(ImConversation::getCid).toList();
        // 单聊里排除我自己，剩下的就是对端成员行
        List<ImConversationMember> peerMembers = singleCids.isEmpty() ? List.of()
                : memberMapper.selectList(new LambdaQueryWrapper<ImConversationMember>()
                .in(ImConversationMember::getCid, singleCids)
                .ne(ImConversationMember::getUserId, userId));
        // cid -> 对端已读水位：我发的消息 seq <= 该值即显示「已读」
        Map<String, Long> peerReadByCid = peerMembers.stream()
                .collect(Collectors.toMap(ImConversationMember::getCid,
                        m -> m.getLastReadSeq() == null ? 0L : m.getLastReadSeq(),
                        (a, b) -> a));
        // cid -> 对端 userId
        Map<String, Long> peerIdByCid = peerMembers.stream()
                .collect(Collectors.toMap(ImConversationMember::getCid,
                        ImConversationMember::getUserId, (a, b) -> a));
        // 4. 批量补齐对端用户资料，用于展示会话标题（昵称/用户名）
        List<Long> peerIds = peerMembers.stream()
                .map(ImConversationMember::getUserId)
                .distinct()
                .toList();
        Map<Long, SysUser> usersById = peerIds.isEmpty() ? Map.of()
                : userMapper.selectByIds(peerIds).stream()
                .collect(Collectors.toMap(SysUser::getId, Function.identity()));
        // 5. 组装 VO：会话本体 + 我的水位 + （单聊）对端信息
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
            // 已读水位可能因并发/回填短暂超过 lastMsgSeq，兜底不出现负数未读
            vo.setUnreadCount(Math.max(0L, lastMsgSeq - lastReadSeq));
            vo.setMentionSeq(mentionSeq);
            vo.setMuted(mutedByCid.getOrDefault(c.getCid(), false));
            // @我 的消息还没被读到 => 展示 @ 提醒
            vo.setHasMention(mentionSeq > lastReadSeq);
            if ("SINGLE".equals(c.getType())) {
                vo.setPeerReadSeq(peerReadByCid.getOrDefault(c.getCid(), 0L));
                Long peerId = peerIdByCid.get(c.getCid());
                vo.setPeerId(peerId);
                // 对端成员行缺失（脏数据）时留空，不影响列表整体返回
                vo.setPeerName(displayName(peerId == null ? null : usersById.get(peerId)));
            }
            return vo;
        }).toList();
    }

    private static String displayName(SysUser user) {
        if (user == null) {
            return null;
        }
        if (user.getNickname() != null && !user.getNickname().isBlank()) {
            return user.getNickname().trim();
        }
        return user.getUsername() == null || user.getUsername().isBlank()
                ? null : user.getUsername().trim();
    }

    /** 批量解析聊天展示名；调用方可复用，避免逐用户查询。 */
    public Map<Long, String> displayNames(Collection<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        List<Long> ids = userIds.stream()
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return userMapper.selectByIds(ids).stream()
                .filter(user -> displayName(user) != null)
                .collect(Collectors.toMap(SysUser::getId, ConversationService::displayName));
    }
}
