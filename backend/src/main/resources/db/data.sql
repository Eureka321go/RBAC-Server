-- RBAC 种子数据（幂等：INSERT IGNORE，显式主键）
-- 默认账号：admin / admin123 、 test / admin123 （BCrypt 哈希，登录后请及时改密）

-- 部门
INSERT IGNORE INTO `sys_dept` (`id`, `parent_id`, `dept_name`, `sort_order`, `status`, `created_at`) VALUES
  (1, 0, '总部',   1, 'ENABLED', NOW()),
  (2, 1, '研发部', 1, 'ENABLED', NOW()),
  (3, 1, '运营部', 2, 'ENABLED', NOW());

-- 角色
INSERT IGNORE INTO `sys_role` (`id`, `role_name`, `role_code`, `data_scope`, `builtin`, `sort_order`, `status`, `remark`, `created_at`) VALUES
  (1, '超级管理员', 'super_admin',   'ALL',            1, 1, 'ENABLED', '拥有所有功能和全部数据', NOW()),
  (2, '系统管理员', 'system_admin',  'OWN_DEPT_CHILD', 1, 2, 'ENABLED', '管理用户、角色、菜单、部门', NOW()),
  (3, '审计管理员', 'audit_admin',   'ALL',            1, 3, 'ENABLED', '查看各类日志', NOW());

-- 用户（admin / 123456）
INSERT IGNORE INTO `sys_user` (`id`, `dept_id`, `username`, `nickname`, `password`, `email`, `phone`, `status`, `remark`, `created_at`) VALUES
  (1, 1, 'admin', '超级管理员', '$2a$10$7JB720yubVSZvUI0rEqK/.VqGOZTH.ulu33dHOiBE8ByOhJIrdAu2', 'admin@rbac.local', '13800000000', 'ENABLED', '内置超级管理员', NOW()),
  (2, 2, 'test',  '测试用户',   '$2a$10$7JB720yubVSZvUI0rEqK/.VqGOZTH.ulu33dHOiBE8ByOhJIrdAu2', 'test@rbac.local',  '13800000001', 'ENABLED', '普通测试账号', NOW());

-- 用户角色
INSERT IGNORE INTO `sys_user_role` (`id`, `user_id`, `role_id`) VALUES
  (1, 1, 1),
  (2, 2, 2);

-- 菜单：目录 + 菜单 + 按钮
INSERT IGNORE INTO `sys_menu` (`id`, `parent_id`, `menu_type`, `menu_name`, `path`, `component`, `permission_code`, `icon`, `sort_order`, `visible`, `keep_alive`, `status`, `created_at`) VALUES
  (1,  0,  'DIR',    '系统管理', '/system', 'Layout',                 NULL,                          'Setting',  1, 1, 0, 'ENABLED', NOW()),
  (10, 1,  'MENU',   '用户管理', 'user',    'system/user/UserView',   'system:user:list',            'User',     1, 1, 1, 'ENABLED', NOW()),
  (20, 1,  'MENU',   '角色管理', 'role',    'system/role/RoleView',   'system:role:list',            'UserFilled', 2, 1, 1, 'ENABLED', NOW()),
  (30, 1,  'MENU',   '菜单管理', 'menu',    'system/menu/MenuView',   'system:menu:list',            'Menu',     3, 1, 1, 'ENABLED', NOW()),
  (40, 1,  'MENU',   '部门管理', 'dept',    'system/dept/DeptView',   'system:dept:list',            'OfficeBuilding', 4, 1, 1, 'ENABLED', NOW()),
  -- 用户按钮
  (11, 10, 'BUTTON', '新增用户', NULL, NULL, 'system:user:add',            NULL, 1, 1, 0, 'ENABLED', NOW()),
  (12, 10, 'BUTTON', '编辑用户', NULL, NULL, 'system:user:edit',           NULL, 2, 1, 0, 'ENABLED', NOW()),
  (13, 10, 'BUTTON', '删除用户', NULL, NULL, 'system:user:delete',         NULL, 3, 1, 0, 'ENABLED', NOW()),
  (14, 10, 'BUTTON', '重置密码', NULL, NULL, 'system:user:reset-password', NULL, 4, 1, 0, 'ENABLED', NOW()),
  (15, 10, 'BUTTON', '分配角色', NULL, NULL, 'system:user:assign-role',    NULL, 5, 1, 0, 'ENABLED', NOW()),
  -- 角色按钮
  (21, 20, 'BUTTON', '新增角色',   NULL, NULL, 'system:role:add',        NULL, 1, 1, 0, 'ENABLED', NOW()),
  (22, 20, 'BUTTON', '编辑角色',   NULL, NULL, 'system:role:edit',       NULL, 2, 1, 0, 'ENABLED', NOW()),
  (23, 20, 'BUTTON', '删除角色',   NULL, NULL, 'system:role:delete',     NULL, 3, 1, 0, 'ENABLED', NOW()),
  (24, 20, 'BUTTON', '分配菜单',   NULL, NULL, 'system:role:grant-menu', NULL, 4, 1, 0, 'ENABLED', NOW()),
  (25, 20, 'BUTTON', '分配数据权限', NULL, NULL, 'system:role:grant-data', NULL, 5, 1, 0, 'ENABLED', NOW()),
  -- 菜单按钮
  (31, 30, 'BUTTON', '新增菜单', NULL, NULL, 'system:menu:add',    NULL, 1, 1, 0, 'ENABLED', NOW()),
  (32, 30, 'BUTTON', '编辑菜单', NULL, NULL, 'system:menu:edit',   NULL, 2, 1, 0, 'ENABLED', NOW()),
  (33, 30, 'BUTTON', '删除菜单', NULL, NULL, 'system:menu:delete', NULL, 3, 1, 0, 'ENABLED', NOW()),
  -- 部门按钮
  (41, 40, 'BUTTON', '新增部门', NULL, NULL, 'system:dept:add',    NULL, 1, 1, 0, 'ENABLED', NOW()),
  (42, 40, 'BUTTON', '编辑部门', NULL, NULL, 'system:dept:edit',   NULL, 2, 1, 0, 'ENABLED', NOW()),
  (43, 40, 'BUTTON', '删除部门', NULL, NULL, 'system:dept:delete', NULL, 3, 1, 0, 'ENABLED', NOW());

-- 角色菜单：超管绑定全部；系统管理员绑定同一批（示例）
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT 1, id FROM `sys_menu`;
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT 2, id FROM `sys_menu`;
