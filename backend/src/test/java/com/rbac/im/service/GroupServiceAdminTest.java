package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImGroup;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImGroupMapper;
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
class GroupServiceAdminTest {

    @Autowired GroupService groupService;
    @Autowired ImGroupMapper groupMapper;
    @Autowired ImGroupMemberMapper gmMapper;

    private String roleOf(long groupId, long userId) {
        return gmMapper.selectOne(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, groupId).eq(ImGroupMember::getUserId, userId)).getRole();
    }

    @Test
    void ownerRenames() {
        CreateGroupResult r = groupService.createGroup(5001L, "旧名", List.of(5002L));
        groupService.rename(5001L, r.getGroupId(), "新名");
        assertThat(groupMapper.selectById(r.getGroupId()).getName()).isEqualTo("新名");
    }

    @Test
    void memberCannotRename() {
        CreateGroupResult r = groupService.createGroup(5101L, "群", List.of(5102L));
        assertThatThrownBy(() -> groupService.rename(5102L, r.getGroupId(), "x"))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void transferOwner_swapsRoles() {
        CreateGroupResult r = groupService.createGroup(5201L, "群", List.of(5202L));
        groupService.transferOwner(5201L, r.getGroupId(), 5202L);
        assertThat(roleOf(r.getGroupId(), 5202L)).isEqualTo("OWNER");
        assertThat(roleOf(r.getGroupId(), 5201L)).isEqualTo("MEMBER");
        assertThat(groupMapper.selectById(r.getGroupId()).getOwnerId()).isEqualTo(5202L);
    }

    @Test
    void ownerSetsAdmin() {
        CreateGroupResult r = groupService.createGroup(5301L, "群", List.of(5302L));
        groupService.setRole(5301L, r.getGroupId(), 5302L, "ADMIN");
        assertThat(roleOf(r.getGroupId(), 5302L)).isEqualTo("ADMIN");
        groupService.setRole(5301L, r.getGroupId(), 5302L, "MEMBER");
        assertThat(roleOf(r.getGroupId(), 5302L)).isEqualTo("MEMBER");
    }

    @Test
    void nonOwnerCannotSetRole() {
        CreateGroupResult r = groupService.createGroup(5401L, "群", List.of(5402L, 5403L));
        assertThatThrownBy(() -> groupService.setRole(5402L, r.getGroupId(), 5403L, "ADMIN"))
                .isInstanceOf(BusinessException.class);
    }
}
