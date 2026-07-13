package com.rbac.system.menu.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.system.menu.entity.SysMenu;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface SysMenuMapper extends BaseMapper<SysMenu> {

    /** 某用户通过其角色可访问的全部启用权限标识（含按钮）。 */
    @Select("""
            SELECT DISTINCT m.permission_code FROM sys_menu m               -- 只取权限码列，DISTINCT 去重；m 是 sys_menu 的别名
            JOIN sys_role_menu rm ON rm.menu_id = m.id                      -- 菜单 ←→ 角色 的桥（按 menu_id 拼接）
            JOIN sys_user_role ur ON ur.role_id = rm.role_id               -- 角色 ←→ 用户 的桥（按 role_id 拼接）
            JOIN sys_role r ON r.id = ur.role_id                           -- 连角色表，仅为下面过滤"禁用角色"
            WHERE ur.user_id = #{userId}                                   -- 入口：只看这个用户的角色（使用参数占位符，防 SQL 注入）
              AND m.deleted = 0 AND m.status = 'ENABLED'                   -- 菜单未被逻辑删除、且处于启用
              AND r.deleted = 0 AND r.status = 'ENABLED'                   -- 角色未被逻辑删除、且处于启用（禁用角色的权限不生效）
              AND m.permission_code IS NOT NULL AND m.permission_code <> ''  -- 权限码非 null 且非空串：只留按钮(BUTTON)，排除目录/菜单
            """)
    List<String> selectPermissionCodesByUserId(Long userId);

    /** 全部启用权限标识（超级管理员用）。 */
    @Select("""
            SELECT DISTINCT permission_code FROM sys_menu
            WHERE deleted = 0 AND status = 'ENABLED'
              AND permission_code IS NOT NULL AND permission_code <> ''
            """)
    List<String> selectAllPermissionCodes();

    /** 某用户可访问的启用 DIR/MENU（不含按钮），用于生成菜单树。 */
    @Select("""
            SELECT DISTINCT m.* FROM sys_menu m
            JOIN sys_role_menu rm ON rm.menu_id = m.id
            JOIN sys_user_role ur ON ur.role_id = rm.role_id
            JOIN sys_role r ON r.id = ur.role_id
            WHERE ur.user_id = #{userId}
              AND m.deleted = 0 AND m.status = 'ENABLED'
              AND m.menu_type IN ('DIR','MENU')
              AND r.deleted = 0 AND r.status = 'ENABLED'
            ORDER BY m.sort_order ASC
            """)
    List<SysMenu> selectVisibleMenusByUserId(Long userId);

    /** 全部启用 DIR/MENU（超级管理员用）。 */
    @Select("""
            SELECT * FROM sys_menu
            WHERE deleted = 0 AND status = 'ENABLED' AND menu_type IN ('DIR','MENU')
            ORDER BY sort_order ASC
            """)
    List<SysMenu> selectAllVisibleMenus();
}
