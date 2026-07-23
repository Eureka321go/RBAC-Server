package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImGroup;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImGroupMapper;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/** 群生命周期管理：建/加/踢/退/解散/改名/转让/设免管理员/禁言，并发 SYSTEM 消息。 */
@Service
public class GroupService {

    private final ImGroupMapper groupMapper;
    private final ImGroupMemberMapper groupMemberMapper;
    private final ConversationService conversationService;
    private final MessageAppender appender;

    @Value("${rbac.im.group-max-members:500}")
    private int maxMembers;

    public GroupService(ImGroupMapper groupMapper,
                        ImGroupMemberMapper groupMemberMapper,
                        ConversationService conversationService,
                        MessageAppender appender) {
        this.groupMapper = groupMapper;
        this.groupMemberMapper = groupMemberMapper;
        this.conversationService = conversationService;
        this.appender = appender;
    }

    @Transactional
    public CreateGroupResult createGroup(long ownerId, String name, List<Long> memberIds) {
        if (name == null || name.isBlank()) {
            throw new BusinessException(400, "im.group.nameRequired");
        }
        ImGroup g = new ImGroup();
        g.setName(name);
        g.setOwnerId(ownerId);
        groupMapper.insert(g);
        long groupId = g.getId();

        LinkedHashSet<Long> all = new LinkedHashSet<>();
        all.add(ownerId);
        if (memberIds != null) {
            all.addAll(memberIds);
        }

        String cid = conversationService.ensureGroupConversation(groupId, new ArrayList<>(all));
        for (Long uid : all) {
            insertGroupMember(groupId, uid, uid == ownerId ? "OWNER" : "MEMBER");
        }
        postSystem(cid, ownerId, "GROUP_CREATE", new ArrayList<>(all), Map.of("name", name));
        return new CreateGroupResult(groupId, cid);
    }

    // ---------- 共享私有助手（后续 Task 复用） ----------

    void insertGroupMember(long groupId, long userId, String role) {
        ImGroupMember m = new ImGroupMember();
        m.setGroupId(groupId);
        m.setUserId(userId);
        m.setRole(role);
        m.setMuted(0);
        groupMemberMapper.insert(m);
    }

    ImGroupMember requireMember(long groupId, long userId) {
        ImGroupMember m = groupMemberMapper.selectOne(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, groupId)
                .eq(ImGroupMember::getUserId, userId));
        if (m == null) {
            throw new BusinessException(403, "im.group.notMember");
        }
        return m;
    }

    void requireManage(ImGroupMember op) {
        if (!"OWNER".equals(op.getRole()) && !"ADMIN".equals(op.getRole())) {
            throw new BusinessException(403, "im.group.noPermission");
        }
    }

    void requireOwner(ImGroupMember op) {
        if (!"OWNER".equals(op.getRole())) {
            throw new BusinessException(403, "im.group.ownerOnly");
        }
    }

    boolean isGroupMember(long groupId, long userId) {
        Long n = groupMemberMapper.selectCount(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, groupId)
                .eq(ImGroupMember::getUserId, userId));
        return n != null && n > 0;
    }

    long memberCount(long groupId) {
        Long n = groupMemberMapper.selectCount(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, groupId));
        return n == null ? 0L : n;
    }

    void postSystem(String cid, long operatorId, String event, List<Long> targetIds, Map<String, Object> extra) {
        Map<String, Object> body = new HashMap<>();
        body.put("event", event);
        body.put("operatorId", operatorId);
        if (targetIds != null) {
            body.put("targetIds", targetIds);
        }
        if (extra != null) {
            body.put("extra", extra);
        }
        appender.append(cid, operatorId, "SYSTEM", body, null);
    }
}
