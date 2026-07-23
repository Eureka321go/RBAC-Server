package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Disabled;
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
    void cannotKickOwner() {
        CreateGroupResult r = groupService.createGroup(4101L, "群", List.of(4102L));
        assertThatThrownBy(() -> groupService.removeMember(4102L, r.getGroupId(), 4101L))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    @Disabled("待 Task 7 setRole：groupService.setRole 尚未实现，@Disabled 仅跳过运行不跳过编译，"
            + "故暂将用例体注释，Task 7 落地 setRole 后取消注释并移除 @Disabled")
    void adminKicksMemberOnly() {
        // 原始用例（Task 7 完成 setRole 后恢复）：
        // CreateGroupResult r = groupService.createGroup(4201L, "群", List.of(4202L, 4203L));
        // groupService.setRole(4201L, r.getGroupId(), 4202L, "ADMIN"); // 依赖 Task 7；若尚未实现，本用例可后置
        // // admin 4202 试踢另一个 admin：先把 4203 也设为 admin
        // groupService.setRole(4201L, r.getGroupId(), 4203L, "ADMIN");
        // assertThatThrownBy(() -> groupService.removeMember(4202L, r.getGroupId(), 4203L))
        //         .isInstanceOf(BusinessException.class);
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
