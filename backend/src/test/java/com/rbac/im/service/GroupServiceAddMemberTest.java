package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties = "rbac.im.group-max-members=3")
@ActiveProfiles("test")
class GroupServiceAddMemberTest {

    @Autowired GroupService groupService;
    @Autowired ImGroupMemberMapper groupMemberMapper;
    @Autowired ImConversationMemberMapper convMemberMapper;

    @Test
    void owner_addMember_insertsBothTables() {
        CreateGroupResult r = groupService.createGroup(3001L, "群", List.of(3002L)); // 2 人
        groupService.addMembers(3001L, r.getGroupId(), List.of(3003L));

        assertThat(groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()))).hasSize(3);
        assertThat(convMemberMapper.selectList(new LambdaQueryWrapper<ImConversationMember>()
                .eq(ImConversationMember::getCid, r.getCid()))).hasSize(3);
    }

    @Test
    void member_cannotAdd() {
        CreateGroupResult r = groupService.createGroup(3101L, "群", List.of(3102L));
        assertThatThrownBy(() -> groupService.addMembers(3102L, r.getGroupId(), List.of(3103L)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("code", 403);
    }

    @Test
    void duplicateAdd_isIdempotent() {
        CreateGroupResult r = groupService.createGroup(3201L, "群", List.of(3202L));
        groupService.addMembers(3201L, r.getGroupId(), List.of(3202L, 3203L)); // 3202 已在群
        assertThat(groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()))).hasSize(3);
    }

    @Test
    void overLimit_rejected() {
        CreateGroupResult r = groupService.createGroup(3301L, "群", List.of(3302L, 3303L)); // 3 人=上限
        assertThatThrownBy(() -> groupService.addMembers(3301L, r.getGroupId(), List.of(3304L)))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void kick_thenReAdd_succeeds() {
        CreateGroupResult r = groupService.createGroup(3401L, "群", List.of(3402L)); // 2 人，未达上限 3
        groupService.removeMember(3401L, r.getGroupId(), 3402L);
        groupService.addMembers(3401L, r.getGroupId(), List.of(3402L));

        List<ImGroupMember> groupMembers = groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()));
        assertThat(groupMembers).extracting(ImGroupMember::getUserId).contains(3402L);
        assertThat(groupMembers.stream().filter(m -> m.getUserId() == 3402L).findFirst().orElseThrow().getRole())
                .isEqualTo("MEMBER");
        assertThat(convMemberMapper.selectList(new LambdaQueryWrapper<ImConversationMember>()
                        .eq(ImConversationMember::getCid, r.getCid())))
                .extracting(ImConversationMember::getUserId).contains(3402L);
    }

    @Test
    void leave_thenRejoin_succeeds() {
        CreateGroupResult r = groupService.createGroup(3501L, "群", List.of(3502L)); // 2 人，未达上限 3
        groupService.leaveGroup(3502L, r.getGroupId());
        groupService.addMembers(3501L, r.getGroupId(), List.of(3502L));

        List<ImGroupMember> groupMembers = groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()));
        assertThat(groupMembers).extracting(ImGroupMember::getUserId).contains(3502L);
        assertThat(groupMembers.stream().filter(m -> m.getUserId() == 3502L).findFirst().orElseThrow().getRole())
                .isEqualTo("MEMBER");
        assertThat(convMemberMapper.selectList(new LambdaQueryWrapper<ImConversationMember>()
                        .eq(ImConversationMember::getCid, r.getCid())))
                .extracting(ImConversationMember::getUserId).contains(3502L);
    }

    @Test
    void createGroup_overLimit_rejected() {
        assertThatThrownBy(() -> groupService.createGroup(3601L, "群", List.of(3602L, 3603L, 3604L)))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("code", 400);
    }
}
