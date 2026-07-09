package com.rbac.security;

import com.rbac.security.model.LoginUser;
import com.rbac.system.dept.entity.SysDept;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.menu.mapper.SysMenuMapper;
import com.rbac.system.role.entity.SysRole;
import com.rbac.system.role.mapper.SysRoleMapper;
import com.rbac.system.user.entity.SysUser;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 根据用户装配 {@link LoginUser}：加载角色、权限标识、部门与合并数据范围。
 */
@Component
public class LoginUserAssembler {

    private static final String SUPER_ADMIN = "super_admin";
    /** 数据范围合并优先级：靠前范围更大。 */
    private static final List<String> DATA_SCOPE_PRIORITY =
            List.of("ALL", "CUSTOM_DEPT", "OWN_DEPT_CHILD", "OWN_DEPT", "SELF");

    private final SysRoleMapper roleMapper;
    private final SysMenuMapper menuMapper;
    private final SysDeptMapper deptMapper;

    public LoginUserAssembler(SysRoleMapper roleMapper, SysMenuMapper menuMapper, SysDeptMapper deptMapper) {
        this.roleMapper = roleMapper;
        this.menuMapper = menuMapper;
        this.deptMapper = deptMapper;
    }

    public LoginUser assemble(SysUser user) {
        LoginUser loginUser = new LoginUser();
        loginUser.setUserId(user.getId());
        loginUser.setUsername(user.getUsername());
        loginUser.setNickname(user.getNickname());
        loginUser.setAvatar(user.getAvatar());
        loginUser.setDeptId(user.getDeptId());

        if (user.getDeptId() != null) {
            SysDept dept = deptMapper.selectById(user.getDeptId());
            if (dept != null) {
                loginUser.setDeptName(dept.getDeptName());
            }
        }

        List<SysRole> roles = roleMapper.selectRolesByUserId(user.getId()).stream()
                .filter(r -> "ENABLED".equals(r.getStatus()))
                .collect(Collectors.toList());
        List<String> roleCodes = roles.stream().map(SysRole::getRoleCode).collect(Collectors.toList());
        loginUser.setRoleCodes(roleCodes);

        boolean isSuper = roleCodes.contains(SUPER_ADMIN);
        List<String> perms = isSuper
                ? menuMapper.selectAllPermissionCodes()
                : menuMapper.selectPermissionCodesByUserId(user.getId());
        Set<String> permissions = new HashSet<>(perms);
        loginUser.setPermissions(permissions);

        loginUser.setDataScope(isSuper ? "ALL" : mergeDataScope(roles));
        return loginUser;
    }

    /** 取所有启用角色中范围最大的数据范围。 */
    private String mergeDataScope(List<SysRole> roles) {
        String result = null;
        int best = Integer.MAX_VALUE;
        for (SysRole role : roles) {
            int idx = DATA_SCOPE_PRIORITY.indexOf(role.getDataScope());
            if (idx >= 0 && idx < best) {
                best = idx;
                result = role.getDataScope();
            }
        }
        return result == null ? "SELF" : result;
    }
}
