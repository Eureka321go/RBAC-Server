package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class GroupServiceRemoveTest {

    @Autowired GroupService groupService;
    @Autowired ImGroupMemberMapper gmMapper;

    private long count(long groupId) {
        return gmMapper.selectCount(new LambdaQueryWrapper<ImGroupMember>().eq(ImGroupMember::getGroupId, groupId));
    }

    @Test
    void owner_kicksMember() {
        CreateGroupResult r = groupService.createGroup(4001L, "群", List.of(4002L, 4003L));
        groupService.removeMember(4001L, r.getGroupId(), 4002L);
        assertThat(count(r.getGroupId())).isEqualTo(2);
    }

    @Test
    void memberCannotKick() {
        CreateGroupResult r = groupService.createGroup(4101L, "群", List.of(4102L));
        assertThatThrownBy(() -> groupService.removeMember(4102L, r.getGroupId(), 4101L))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("messageKey", "im.group.noPermission");
    }

    @Test
    void adminKicksMemberOnly() {
        CreateGroupResult r = groupService.createGroup(4201L, "群", List.of(4202L, 4203L));
        groupService.setRole(4201L, r.getGroupId(), 4202L, "ADMIN");
        // admin 4202 试踢另一个 admin：先把 4203 也设为 admin
        groupService.setRole(4201L, r.getGroupId(), 4203L, "ADMIN");
        assertThatThrownBy(() -> groupService.removeMember(4202L, r.getGroupId(), 4203L))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void adminCannotKickOwner() {
        CreateGroupResult r = groupService.createGroup(4501L, "群", List.of(4502L));
        long aId = 4501L;
        long bId = 4502L;
        groupService.setRole(aId, r.getGroupId(), bId, "ADMIN");
        assertThatThrownBy(() -> groupService.removeMember(bId, r.getGroupId(), aId))
                .isInstanceOf(com.rbac.common.exception.BusinessException.class)
                .hasFieldOrPropertyWithValue("messageKey", "im.group.cannotKickOwner");
    }

    @Test
    void memberLeaves() {
        CreateGroupResult r = groupService.createGroup(4301L, "群", List.of(4302L));
        groupService.leaveGroup(4302L, r.getGroupId());
        assertThat(count(r.getGroupId())).isEqualTo(1);
    }

    @Test
    void ownerCannotLeave() {
        CreateGroupResult r = groupService.createGroup(4401L, "群", List.of(4402L));
        assertThatThrownBy(() -> groupService.leaveGroup(4401L, r.getGroupId()))
                .isInstanceOf(BusinessException.class);
    }
}
