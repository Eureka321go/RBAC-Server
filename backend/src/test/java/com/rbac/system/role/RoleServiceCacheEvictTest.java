package com.rbac.system.role;

import com.rbac.system.menu.service.PermissionCacheService;
import com.rbac.system.role.entity.SysRole;
import com.rbac.system.role.mapper.SysRoleDeptMapper;
import com.rbac.system.role.mapper.SysRoleMapper;
import com.rbac.system.role.mapper.SysRoleMenuMapper;
import com.rbac.system.role.service.RoleService;
import com.rbac.system.user.mapper.SysUserRoleMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * WIP 红灯测试（Phase 1 遗留，未跟踪）：期望 RoleService 注入 PermissionCacheService，
 * 且 grantMenus 后调用 cache.evictAll()。生产代码尚未实现 → 目前编译不过（预期的红灯）。
 *
 * 注：原始文件在 Phase 2 执行期间被某实现子代理误改写为无断言版本，原文已丢失；
 * 本文件按记忆 im-phase1-wip-stash 的描述忠实重建，请核对是否与你原来的写法一致。
 */
class RoleServiceCacheEvictTest {

    @Test
    void grantMenusEvictsPermissionCache() {
        SysRoleMapper roleMapper = mock(SysRoleMapper.class);
        SysRoleMenuMapper roleMenuMapper = mock(SysRoleMenuMapper.class);
        SysRoleDeptMapper roleDeptMapper = mock(SysRoleDeptMapper.class);
        SysUserRoleMapper userRoleMapper = mock(SysUserRoleMapper.class);
        PermissionCacheService permissionCacheService = mock(PermissionCacheService.class);
        RoleService service = new RoleService(roleMapper, roleMenuMapper, roleDeptMapper,
                userRoleMapper, permissionCacheService);

        SysRole role = new SysRole();
        role.setId(1L);
        when(roleMapper.selectById(1L)).thenReturn(role);

        service.grantMenus(1L, List.of(10L, 11L));

        verify(permissionCacheService).evictAll();
    }
}
