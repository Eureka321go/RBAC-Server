package com.rbac.system.dashboard.service;

import com.rbac.system.dashboard.vo.DashboardStatsVO;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.menu.mapper.SysMenuMapper;
import com.rbac.system.role.mapper.SysRoleMapper;
import com.rbac.system.user.mapper.SysUserMapper;
import org.springframework.stereotype.Service;

/** 首页概览统计服务：汇总用户、角色、菜单、部门总数（逻辑删除已由 MyBatis-Plus 自动过滤）。 */
@Service
public class DashboardService {

    private final SysUserMapper userMapper;
    private final SysRoleMapper roleMapper;
    private final SysMenuMapper menuMapper;
    private final SysDeptMapper deptMapper;

    public DashboardService(SysUserMapper userMapper, SysRoleMapper roleMapper,
                            SysMenuMapper menuMapper, SysDeptMapper deptMapper) {
        this.userMapper = userMapper;
        this.roleMapper = roleMapper;
        this.menuMapper = menuMapper;
        this.deptMapper = deptMapper;
    }

    public DashboardStatsVO stats() {
        DashboardStatsVO vo = new DashboardStatsVO();
        vo.setUserCount(userMapper.selectCount(null));
        vo.setRoleCount(roleMapper.selectCount(null));
        vo.setMenuCount(menuMapper.selectCount(null));
        vo.setDeptCount(deptMapper.selectCount(null));
        return vo;
    }
}
