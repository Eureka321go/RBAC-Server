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

-- 用户岗位
INSERT IGNORE INTO `sys_user_post` (`id`, `user_id`, `post_id`) VALUES
  (1, 1, 1),
  (2, 2, 3);

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
  (43, 40, 'BUTTON', '删除部门', NULL, NULL, 'system:dept:delete', NULL, 3, 1, 0, 'ENABLED', NOW()),
  -- 岗位管理
  (50, 1,  'MENU',   '岗位管理', 'post',   'system/post/PostView',   'system:post:list',   'Postcard', 5, 1, 1, 'ENABLED', NOW()),
  (51, 50, 'BUTTON', '新增岗位', NULL, NULL, 'system:post:add',    NULL, 1, 1, 0, 'ENABLED', NOW()),
  (52, 50, 'BUTTON', '编辑岗位', NULL, NULL, 'system:post:edit',   NULL, 2, 1, 0, 'ENABLED', NOW()),
  (53, 50, 'BUTTON', '删除岗位', NULL, NULL, 'system:post:delete', NULL, 3, 1, 0, 'ENABLED', NOW()),
  -- 参数配置
  (60, 1,  'MENU',   '参数配置', 'config', 'system/config/ConfigView', 'system:config:list', 'Tools', 6, 1, 1, 'ENABLED', NOW()),
  (61, 60, 'BUTTON', '新增参数', NULL, NULL, 'system:config:add',    NULL, 1, 1, 0, 'ENABLED', NOW()),
  (62, 60, 'BUTTON', '编辑参数', NULL, NULL, 'system:config:edit',   NULL, 2, 1, 0, 'ENABLED', NOW()),
  (63, 60, 'BUTTON', '删除参数', NULL, NULL, 'system:config:delete', NULL, 3, 1, 0, 'ENABLED', NOW()),
  -- 字典管理
  (70, 1,  'MENU',   '字典管理', 'dict',   'system/dict/DictView',   'system:dict:list',   'Collection', 7, 1, 1, 'ENABLED', NOW()),
  (71, 70, 'BUTTON', '新增字典', NULL, NULL, 'system:dict:add',    NULL, 1, 1, 0, 'ENABLED', NOW()),
  (72, 70, 'BUTTON', '编辑字典', NULL, NULL, 'system:dict:edit',   NULL, 2, 1, 0, 'ENABLED', NOW()),
  (73, 70, 'BUTTON', '删除字典', NULL, NULL, 'system:dict:delete', NULL, 3, 1, 0, 'ENABLED', NOW()),
  -- 日志管理
  (80, 1,  'DIR',    '日志管理', 'log',    NULL,                     NULL,                 'Document', 8, 1, 0, 'ENABLED', NOW()),
  (81, 80, 'MENU',   '登录日志', 'login-log',     'system/log/LoginLogView',     'system:login-log:list',     'Key',       1, 1, 1, 'ENABLED', NOW()),
  (82, 80, 'MENU',   '操作日志', 'operation-log', 'system/log/OperationLogView', 'system:operation-log:list', 'Tickets',   2, 1, 1, 'ENABLED', NOW());

-- 角色菜单：超管绑定全部；系统管理员绑定同一批（示例）
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT 1, id FROM `sys_menu`;
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT 2, id FROM `sys_menu`;

-- 岗位
INSERT IGNORE INTO `sys_post` (`id`, `post_name`, `post_code`, `sort_order`, `status`, `remark`, `created_at`) VALUES
  (1, '董事长',   'ceo', 1, 'ENABLED', '', NOW()),
  (2, '项目经理', 'pm',  2, 'ENABLED', '', NOW()),
  (3, '普通员工', 'staff', 3, 'ENABLED', '', NOW());

-- 参数配置
INSERT IGNORE INTO `sys_config` (`id`, `config_name`, `config_key`, `config_value`, `config_type`, `builtin`, `sensitive`, `remark`, `created_at`) VALUES
  (1, '用户初始密码', 'sys.user.initPassword', '123456', 'STRING', 1, 0, '新增用户默认密码', NOW()),
  (2, '账号自助注册', 'sys.account.registerEnabled', 'false', 'BOOLEAN', 1, 0, '是否开放注册', NOW());

-- 字典类型
INSERT IGNORE INTO `sys_dict_type` (`id`, `dict_name`, `dict_code`, `status`, `remark`, `created_at`) VALUES
  (1, '用户性别', 'sys_user_gender', 'ENABLED', '用户性别列表', NOW()),
  (2, '系统状态', 'sys_common_status', 'ENABLED', '启用禁用状态', NOW());

-- 字典数据
INSERT IGNORE INTO `sys_dict_data` (`id`, `dict_type_id`, `label`, `value`, `sort_order`, `default_flag`, `status`, `created_at`) VALUES
  (1, 1, '男', 'MALE',    1, 1, 'ENABLED', NOW()),
  (2, 1, '女', 'FEMALE',  2, 0, 'ENABLED', NOW()),
  (3, 1, '未知', 'UNKNOWN', 3, 0, 'ENABLED', NOW()),
  (4, 2, '启用', 'ENABLED',  1, 1, 'ENABLED', NOW()),
  (5, 2, '禁用', 'DISABLED', 2, 0, 'ENABLED', NOW());

-- ===================== 工作流 / 审批 菜单与权限 =====================
INSERT IGNORE INTO `sys_menu` (`id`, `parent_id`, `menu_type`, `menu_name`, `path`, `component`, `permission_code`, `icon`, `sort_order`, `visible`, `keep_alive`, `status`, `created_at`) VALUES
  -- 管理端：工作流（挂系统层级之后）
  (90,  0,  'DIR',    '工作流',   '/workflow', 'Layout',                             NULL,                          'Share',    9, 1, 0, 'ENABLED', NOW()),
  (91,  90, 'MENU',   '流程定义', 'definition', 'workflow/definition/DefinitionView', 'workflow:definition:list',    'SetUp',    1, 1, 1, 'ENABLED', NOW()),
  (911, 91, 'BUTTON', '新增定义', NULL, NULL, 'workflow:definition:add',    NULL, 1, 1, 0, 'ENABLED', NOW()),
  (912, 91, 'BUTTON', '编辑定义', NULL, NULL, 'workflow:definition:edit',   NULL, 2, 1, 0, 'ENABLED', NOW()),
  (913, 91, 'BUTTON', '删除定义', NULL, NULL, 'workflow:definition:remove', NULL, 3, 1, 0, 'ENABLED', NOW()),
  (914, 91, 'BUTTON', '定义详情', NULL, NULL, 'workflow:definition:query',  NULL, 4, 1, 0, 'ENABLED', NOW()),
  -- 业务端：我的审批（权限码留空，随菜单授权可见）
  (100, 0,   'DIR',  '我的审批', '/approval', 'Layout',                        NULL, 'Tickets',  10, 1, 0, 'ENABLED', NOW()),
  (101, 100, 'MENU', '我的待办', 'todo', 'workflow/task/TodoView',            NULL, 'Bell',      1, 1, 1, 'ENABLED', NOW()),
  (102, 100, 'MENU', '我的已办', 'done', 'workflow/task/DoneView',            NULL, 'Finished',  2, 1, 1, 'ENABLED', NOW()),
  (103, 100, 'MENU', '我发起的', 'mine', 'workflow/instance/MineView',        NULL, 'Promotion', 3, 1, 1, 'ENABLED', NOW()),
  (1031,103, 'BUTTON','发起审批', NULL, NULL, 'workflow:instance:start',      NULL, 1, 1, 0, 'ENABLED', NOW()),
  (104, 100, 'MENU', '抄送我的', 'cc',   'workflow/instance/CcView',          NULL, 'Message',   4, 1, 1, 'ENABLED', NOW());

-- 将工作流菜单授权给超管(1)与系统管理员(2)
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT 1, id FROM `sys_menu` WHERE id IN (90,91,911,912,913,914,100,101,102,103,1031,104);
INSERT IGNORE INTO `sys_role_menu` (`role_id`, `menu_id`)
SELECT 2, id FROM `sys_menu` WHERE id IN (90,91,911,912,913,914,100,101,102,103,1031,104);

-- ===================== 内置示例：请假审批 =====================
INSERT IGNORE INTO `wf_process_definition` (`id`, `process_key`, `name`, `category`, `form_key`, `version`, `status`, `remark`, `created_at`) VALUES
  (1, 'leave', '请假审批', 'hr', 'leave', 1, 'ENABLED', '内置示例：部门经理审批；请假天数>3 需分管领导再审', NOW());

INSERT IGNORE INTO `wf_process_node` (`id`, `definition_id`, `node_order`, `node_name`, `assignee_type`, `assignee_value`, `approve_mode`, `reject_strategy`, `condition_expr`, `created_at`) VALUES
  (1, 1, 1, '部门经理审批', 'DEPT_LEADER',      NULL, 'ANY', 'TO_INITIATOR', NULL,       NOW()),
  (2, 1, 2, '分管领导审批', 'INITIATOR_LEADER', NULL, 'ANY', 'TO_PREV',      'days > 3', NOW());
