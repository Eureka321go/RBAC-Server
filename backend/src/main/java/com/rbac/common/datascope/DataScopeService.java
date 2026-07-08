package com.rbac.common.datascope;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.rbac.common.util.SecurityUtils;
import com.rbac.security.model.LoginUser;
import com.rbac.system.dept.entity.SysDept;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.role.entity.SysRole;
import com.rbac.system.role.entity.SysRoleDept;
import com.rbac.system.role.mapper.SysRoleDeptMapper;
import com.rbac.system.role.mapper.SysRoleMapper;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 数据权限计算：按当前登录用户的角色数据范围，取所有角色可见范围的并集。
 * 优先级 ALL &gt; CUSTOM_DEPT &gt; OWN_DEPT_CHILD &gt; OWN_DEPT &gt; SELF —— 只要任一角色为 ALL 即放行全部。
 */
@Service
public class DataScopeService {

    private final SysRoleMapper roleMapper;
    private final SysRoleDeptMapper roleDeptMapper;
    private final SysDeptMapper deptMapper;

    public DataScopeService(SysRoleMapper roleMapper, SysRoleDeptMapper roleDeptMapper, SysDeptMapper deptMapper) {
        this.roleMapper = roleMapper;
        this.roleDeptMapper = roleDeptMapper;
        this.deptMapper = deptMapper;
    }

    /** 计算当前登录用户的数据范围。未登录时按仅本人处理。 */
    public DataScopeQuery calculate() {
        LoginUser loginUser = SecurityUtils.getLoginUserOrNull();
        if (loginUser == null) {
            return new DataScopeQuery();
        }
        if (SecurityUtils.isSuperAdmin()) {
            return DataScopeQuery.all();
        }

        List<SysRole> roles = roleMapper.selectRolesByUserId(loginUser.getUserId());
        Set<Long> deptIds = new HashSet<>();
        boolean includeSelf = false;
        Map<Long, List<Long>> childrenIndex = null;

        for (SysRole role : roles) {
            String scope = role.getDataScope();
            if (scope == null) {
                continue;
            }
            switch (scope) {
                case "ALL" -> {
                    return DataScopeQuery.all();
                }
                case "CUSTOM_DEPT" -> {
                    List<SysRoleDept> customs = roleDeptMapper.selectList(
                            Wrappers.<SysRoleDept>lambdaQuery().eq(SysRoleDept::getRoleId, role.getId()));
                    if (childrenIndex == null && !customs.isEmpty()) {
                        childrenIndex = buildChildrenIndex();
                    }
                    for (SysRoleDept rd : customs) {
                        deptIds.add(rd.getDeptId());
                        if (rd.getIncludeChildren() != null && rd.getIncludeChildren() == 1) {
                            collectDescendants(rd.getDeptId(), childrenIndex, deptIds);
                        }
                    }
                }
                case "OWN_DEPT_CHILD" -> {
                    if (loginUser.getDeptId() != null) {
                        if (childrenIndex == null) {
                            childrenIndex = buildChildrenIndex();
                        }
                        deptIds.add(loginUser.getDeptId());
                        collectDescendants(loginUser.getDeptId(), childrenIndex, deptIds);
                    }
                }
                case "OWN_DEPT" -> {
                    if (loginUser.getDeptId() != null) {
                        deptIds.add(loginUser.getDeptId());
                    }
                }
                case "SELF" -> includeSelf = true;
                default -> {
                    // 未知范围按最严格处理，不放行
                }
            }
        }

        DataScopeQuery query = new DataScopeQuery();
        query.setDeptIds(deptIds);
        query.setSelfUserId(includeSelf ? loginUser.getUserId() : null);
        return query;
    }

    private Map<Long, List<Long>> buildChildrenIndex() {
        List<SysDept> all = deptMapper.selectList(null);
        return all.stream()
                .filter(d -> d.getParentId() != null)
                .collect(Collectors.groupingBy(SysDept::getParentId,
                        Collectors.mapping(SysDept::getId, Collectors.toList())));
    }

    private void collectDescendants(Long deptId, Map<Long, List<Long>> childrenIndex, Set<Long> acc) {
        if (childrenIndex == null) {
            return;
        }
        List<Long> children = childrenIndex.get(deptId);
        if (children == null) {
            return;
        }
        for (Long child : children) {
            if (acc.add(child)) {
                collectDescendants(child, childrenIndex, acc);
            }
        }
    }
}
