package com.rbac.workflow.support;

import com.rbac.system.dept.entity.SysDept;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AssigneeOptionServiceTest {

    @Test
    void searchReturnsOnlyLimitedPublicUserFieldsWithDepartmentName() {
        SysUserMapper userMapper = mock(SysUserMapper.class);
        SysDeptMapper deptMapper = mock(SysDeptMapper.class);
        when(userMapper.selectList(any())).thenReturn(List.of(user(2L, 9L, "lisi", "李四")));
        when(deptMapper.selectBatchIds(any())).thenReturn(List.of(dept(9L, "研发部")));

        var users = new AssigneeOptionService(userMapper, deptMapper).search(" li ", 20);

        assertThat(users).hasSize(1);
        assertThat(users.getFirst().getId()).isEqualTo(2L);
        assertThat(users.getFirst().getUsername()).isEqualTo("lisi");
        assertThat(users.getFirst().getNickname()).isEqualTo("李四");
        assertThat(users.getFirst().getDeptName()).isEqualTo("研发部");
    }

    @Test
    void normalizeLimitUsesSafeBounds() {
        assertThat(AssigneeOptionService.normalizeLimit(null)).isEqualTo(20);
        assertThat(AssigneeOptionService.normalizeLimit(0)).isEqualTo(1);
        assertThat(AssigneeOptionService.normalizeLimit(99)).isEqualTo(50);
    }

    private SysUser user(Long id, Long deptId, String username, String nickname) {
        SysUser user = new SysUser();
        user.setId(id);
        user.setDeptId(deptId);
        user.setUsername(username);
        user.setNickname(nickname);
        user.setStatus("ENABLED");
        return user;
    }

    private SysDept dept(Long id, String name) {
        SysDept dept = new SysDept();
        dept.setId(id);
        dept.setDeptName(name);
        return dept;
    }
}
