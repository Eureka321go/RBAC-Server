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
}
