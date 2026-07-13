-- RBAC 首期最小可用范围建表脚本（幂等：IF NOT EXISTS）
-- 数据库字段 snake_case；状态/类型枚举以 varchar 落库，API 层保持字符串。

CREATE TABLE IF NOT EXISTS `sys_dept` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `parent_id`      BIGINT       NOT NULL DEFAULT 0 COMMENT '父部门 ID，0 为顶级',
  `dept_name`      VARCHAR(64)  NOT NULL COMMENT '部门名称',
  `leader_user_id` BIGINT       NULL COMMENT '负责人用户 ID',
  `phone`          VARCHAR(32)  NULL COMMENT '联系电话',
  `email`          VARCHAR(128) NULL COMMENT '邮箱',
  `sort_order`     INT          NOT NULL DEFAULT 0 COMMENT '排序',
  `status`         VARCHAR(16)  NOT NULL DEFAULT 'ENABLED' COMMENT '状态 ENABLED/DISABLED',
  `created_by`     BIGINT       NULL COMMENT '创建人',
  `created_at`     DATETIME     NULL COMMENT '创建时间',
  `updated_by`     BIGINT       NULL COMMENT '更新人',
  `updated_at`     DATETIME     NULL COMMENT '更新时间',
  `deleted`        TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  KEY `idx_dept_parent` (`parent_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '部门表';

CREATE TABLE IF NOT EXISTS `sys_user` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `dept_id`       BIGINT       NULL COMMENT '部门 ID',
  `username`      VARCHAR(64)  NOT NULL COMMENT '登录账号',
  `nickname`      VARCHAR(64)  NOT NULL COMMENT '昵称',
  `password`     VARCHAR(100) NOT NULL COMMENT 'BCrypt 密码',
  `email`         VARCHAR(128) NULL COMMENT '邮箱',
  `phone`         VARCHAR(32)  NULL COMMENT '手机号',
  `avatar`        VARCHAR(255) NULL COMMENT '头像',
  `gender`        VARCHAR(16)  NULL COMMENT '性别',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'ENABLED' COMMENT '状态 ENABLED/DISABLED',
  `last_login_at` DATETIME     NULL COMMENT '最后登录时间',
  `last_login_ip` VARCHAR(64)  NULL COMMENT '最后登录 IP',
  `remark`        VARCHAR(255) NULL COMMENT '备注',
  `created_by`    BIGINT       NULL COMMENT '创建人',
  `created_at`    DATETIME     NULL COMMENT '创建时间',
  `updated_by`    BIGINT       NULL COMMENT '更新人',
  `updated_at`    DATETIME     NULL COMMENT '更新时间',
  `deleted`       TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_username` (`username`, `deleted`),
  KEY `idx_user_dept` (`dept_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '用户表';

CREATE TABLE IF NOT EXISTS `sys_role` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `role_name`  VARCHAR(64)  NOT NULL COMMENT '角色名称',
  `role_code`  VARCHAR(64)  NOT NULL COMMENT '角色编码',
  `data_scope` VARCHAR(32)  NOT NULL DEFAULT 'SELF' COMMENT '数据范围 ALL/CUSTOM_DEPT/OWN_DEPT/OWN_DEPT_CHILD/SELF',
  `builtin`    TINYINT      NOT NULL DEFAULT 0 COMMENT '是否内置 0/1',
  `sort_order` INT          NOT NULL DEFAULT 0 COMMENT '排序',
  `status`     VARCHAR(16)  NOT NULL DEFAULT 'ENABLED' COMMENT '状态 ENABLED/DISABLED',
  `remark`     VARCHAR(255) NULL COMMENT '备注',
  `created_by` BIGINT       NULL COMMENT '创建人',
  `created_at` DATETIME     NULL COMMENT '创建时间',
  `updated_by` BIGINT       NULL COMMENT '更新人',
  `updated_at` DATETIME     NULL COMMENT '更新时间',
  `deleted`    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_code` (`role_code`, `deleted`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '角色表';

CREATE TABLE IF NOT EXISTS `sys_menu` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `parent_id`       BIGINT       NOT NULL DEFAULT 0 COMMENT '父菜单 ID，0 为顶级',
  `menu_type`       VARCHAR(16)  NOT NULL COMMENT '类型 DIR/MENU/BUTTON',
  `menu_name`       VARCHAR(64)  NOT NULL COMMENT '菜单名称',
  `path`            VARCHAR(255) NULL COMMENT '路由路径',
  `component`       VARCHAR(255) NULL COMMENT '组件路径',
  `permission_code` VARCHAR(128) NULL COMMENT '权限标识',
  `icon`            VARCHAR(64)  NULL COMMENT '图标',
  `sort_order`      INT          NOT NULL DEFAULT 0 COMMENT '排序',
  `visible`         TINYINT      NOT NULL DEFAULT 1 COMMENT '是否显示 0/1',
  `keep_alive`      TINYINT      NOT NULL DEFAULT 0 COMMENT '是否缓存 0/1',
  `external_link`   VARCHAR(255) NULL COMMENT '外链地址',
  `status`          VARCHAR(16)  NOT NULL DEFAULT 'ENABLED' COMMENT '状态 ENABLED/DISABLED',
  `created_by`      BIGINT       NULL COMMENT '创建人',
  `created_at`      DATETIME     NULL COMMENT '创建时间',
  `updated_by`      BIGINT       NULL COMMENT '更新人',
  `updated_at`      DATETIME     NULL COMMENT '更新时间',
  `deleted`         TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  KEY `idx_menu_parent` (`parent_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '菜单表';

CREATE TABLE IF NOT EXISTS `sys_user_role` (
  `id`      BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id` BIGINT NOT NULL COMMENT '用户 ID',
  `role_id` BIGINT NOT NULL COMMENT '角色 ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_role` (`user_id`, `role_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '用户角色关联表';

CREATE TABLE IF NOT EXISTS `sys_role_menu` (
  `id`      BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
  `role_id` BIGINT NOT NULL COMMENT '角色 ID',
  `menu_id` BIGINT NOT NULL COMMENT '菜单 ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_menu` (`role_id`, `menu_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '角色菜单关联表';

CREATE TABLE IF NOT EXISTS `sys_role_dept` (
  `id`               BIGINT  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `role_id`          BIGINT  NOT NULL COMMENT '角色 ID',
  `dept_id`          BIGINT  NOT NULL COMMENT '授权部门 ID',
  `include_children` TINYINT NOT NULL DEFAULT 1 COMMENT '是否包含子部门 0/1',
  `created_at`       DATETIME NULL COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_dept` (`role_id`, `dept_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '角色自定义数据范围部门表';

CREATE TABLE IF NOT EXISTS `sys_post` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `post_name`  VARCHAR(64)  NOT NULL COMMENT '岗位名称',
  `post_code`  VARCHAR(64)  NOT NULL COMMENT '岗位编码',
  `sort_order` INT          NOT NULL DEFAULT 0 COMMENT '排序',
  `status`     VARCHAR(16)  NOT NULL DEFAULT 'ENABLED' COMMENT '状态 ENABLED/DISABLED',
  `remark`     VARCHAR(255) NULL COMMENT '备注',
  `created_by` BIGINT       NULL COMMENT '创建人',
  `created_at` DATETIME     NULL COMMENT '创建时间',
  `updated_by` BIGINT       NULL COMMENT '更新人',
  `updated_at` DATETIME     NULL COMMENT '更新时间',
  `deleted`    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_post_code` (`post_code`, `deleted`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '岗位表';

CREATE TABLE IF NOT EXISTS `sys_user_post` (
  `id`      BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id` BIGINT NOT NULL COMMENT '用户 ID',
  `post_id` BIGINT NOT NULL COMMENT '岗位 ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_post` (`user_id`, `post_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '用户岗位关联表';

CREATE TABLE IF NOT EXISTS `sys_config` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `config_name`  VARCHAR(128) NOT NULL COMMENT '参数名称',
  `config_key`   VARCHAR(128) NOT NULL COMMENT '参数键',
  `config_value` VARCHAR(512) NULL COMMENT '参数值',
  `config_type`  VARCHAR(32)  NOT NULL DEFAULT 'STRING' COMMENT '参数类型',
  `builtin`      TINYINT      NOT NULL DEFAULT 0 COMMENT '是否内置 0/1',
  `sensitive`    TINYINT      NOT NULL DEFAULT 0 COMMENT '是否敏感 0/1',
  `remark`       VARCHAR(255) NULL COMMENT '备注',
  `created_by`   BIGINT       NULL COMMENT '创建人',
  `created_at`   DATETIME     NULL COMMENT '创建时间',
  `updated_by`   BIGINT       NULL COMMENT '更新人',
  `updated_at`   DATETIME     NULL COMMENT '更新时间',
  `deleted`      TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`, `deleted`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '参数配置表';

CREATE TABLE IF NOT EXISTS `sys_dict_type` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `dict_name`  VARCHAR(64)  NOT NULL COMMENT '字典名称',
  `dict_code`  VARCHAR(64)  NOT NULL COMMENT '字典编码',
  `status`     VARCHAR(16)  NOT NULL DEFAULT 'ENABLED' COMMENT '状态 ENABLED/DISABLED',
  `remark`     VARCHAR(255) NULL COMMENT '备注',
  `created_by` BIGINT       NULL COMMENT '创建人',
  `created_at` DATETIME     NULL COMMENT '创建时间',
  `updated_by` BIGINT       NULL COMMENT '更新人',
  `updated_at` DATETIME     NULL COMMENT '更新时间',
  `deleted`    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dict_code` (`dict_code`, `deleted`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '字典类型表';

CREATE TABLE IF NOT EXISTS `sys_dict_data` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `dict_type_id` BIGINT       NOT NULL COMMENT '字典类型 ID',
  `label`        VARCHAR(128) NOT NULL COMMENT '字典标签',
  `value`        VARCHAR(128) NOT NULL COMMENT '字典键值',
  `sort_order`   INT          NOT NULL DEFAULT 0 COMMENT '排序',
  `default_flag` TINYINT      NOT NULL DEFAULT 0 COMMENT '是否默认 0/1',
  `status`       VARCHAR(16)  NOT NULL DEFAULT 'ENABLED' COMMENT '状态 ENABLED/DISABLED',
  `remark`       VARCHAR(255) NULL COMMENT '备注',
  `created_by`   BIGINT       NULL COMMENT '创建人',
  `created_at`   DATETIME     NULL COMMENT '创建时间',
  `updated_by`   BIGINT       NULL COMMENT '更新人',
  `updated_at`   DATETIME     NULL COMMENT '更新时间',
  `deleted`      TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  KEY `idx_dict_data_type` (`dict_type_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '字典数据表';

CREATE TABLE IF NOT EXISTS `sys_login_log` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `username`   VARCHAR(64)  NULL COMMENT '登录账号',
  `status`     VARCHAR(16)  NOT NULL COMMENT '结果 SUCCESS/FAILURE',
  `message`    VARCHAR(255) NULL COMMENT '提示信息',
  `ip`         VARCHAR(64)  NULL COMMENT '登录 IP',
  `user_agent` VARCHAR(512) NULL COMMENT 'User-Agent',
  `login_at`   DATETIME     NULL COMMENT '登录时间',
  PRIMARY KEY (`id`),
  KEY `idx_login_log_username` (`username`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '登录日志表';

CREATE TABLE IF NOT EXISTS `sys_operation_log` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `title`       VARCHAR(128) NULL COMMENT '操作模块',
  `business_type` VARCHAR(32) NULL COMMENT '业务类型',
  `method`      VARCHAR(255) NULL COMMENT '请求方法',
  `request_uri` VARCHAR(255) NULL COMMENT '请求地址',
  `request_method` VARCHAR(16) NULL COMMENT 'HTTP 方法',
  `operator_id` BIGINT       NULL COMMENT '操作人 ID',
  `operator`    VARCHAR(64)  NULL COMMENT '操作人账号',
  `dept_id`     BIGINT       NULL COMMENT '操作人部门 ID',
  `params`      VARCHAR(2000) NULL COMMENT '请求参数（限长）',
  `status`      VARCHAR(16)  NOT NULL COMMENT '结果 SUCCESS/FAILURE',
  `error_msg`   VARCHAR(2000) NULL COMMENT '错误信息',
  `cost_ms`     BIGINT       NULL COMMENT '耗时毫秒',
  `ip`          VARCHAR(64)  NULL COMMENT '操作 IP',
  `operate_at`  DATETIME     NULL COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_oper_log_operator` (`operator_id`),
  KEY `idx_oper_log_dept` (`dept_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '操作日志表';

-- ===================== 工作流 / 审批（wf_*） =====================

CREATE TABLE IF NOT EXISTS `wf_process_definition` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `process_key` VARCHAR(64)  NOT NULL COMMENT '流程标识，如 leave',
  `name`        VARCHAR(128) NOT NULL COMMENT '流程名称',
  `category`    VARCHAR(64)  NULL COMMENT '分类（字典 wf_category）',
  `form_key`    VARCHAR(64)  NULL COMMENT '关联业务表单标识',
  `version`     INT          NOT NULL DEFAULT 1 COMMENT '版本号',
  `status`      VARCHAR(16)  NOT NULL DEFAULT 'ENABLED' COMMENT '状态 ENABLED/DISABLED',
  `remark`      VARCHAR(255) NULL COMMENT '说明',
  `created_by`  BIGINT       NULL COMMENT '创建人',
  `created_at`  DATETIME     NULL COMMENT '创建时间',
  `updated_by`  BIGINT       NULL COMMENT '更新人',
  `updated_at`  DATETIME     NULL COMMENT '更新时间',
  `deleted`     TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wf_def_key_ver` (`process_key`, `version`, `deleted`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '流程定义表';

CREATE TABLE IF NOT EXISTS `wf_process_node` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `definition_id`   BIGINT       NOT NULL COMMENT '所属定义 ID',
  `node_order`      INT          NOT NULL COMMENT '节点顺序（从 1 递增）',
  `node_name`       VARCHAR(128) NOT NULL COMMENT '节点名称',
  `assignee_type`   VARCHAR(32)  NOT NULL COMMENT '审批人来源 USER/ROLE/POST/DEPT_LEADER/INITIATOR_SELF/INITIATOR_LEADER',
  `assignee_value`  VARCHAR(255) NULL COMMENT '来源取值（id，多个逗号分隔）',
  `approve_mode`    VARCHAR(16)  NOT NULL DEFAULT 'ANY' COMMENT '会签策略 ANY/ALL/SEQUENTIAL',
  `reject_strategy` VARCHAR(16)  NOT NULL DEFAULT 'TO_INITIATOR' COMMENT '驳回策略 TO_INITIATOR/TO_PREV',
  `condition_expr`  VARCHAR(255) NULL COMMENT '分支条件（如 amount > 5000），空则必经',
  `created_by`      BIGINT       NULL COMMENT '创建人',
  `created_at`      DATETIME     NULL COMMENT '创建时间',
  `updated_by`      BIGINT       NULL COMMENT '更新人',
  `updated_at`      DATETIME     NULL COMMENT '更新时间',
  `deleted`         TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  KEY `idx_wf_node_def` (`definition_id`, `node_order`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '流程节点表';

CREATE TABLE IF NOT EXISTS `wf_process_instance` (
  `id`                 BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `definition_id`      BIGINT       NOT NULL COMMENT '流程定义 ID（锁定发起时版本）',
  `process_key`        VARCHAR(64)  NOT NULL COMMENT '流程标识（冗余）',
  `business_key`       VARCHAR(64)  NULL COMMENT '业务单据 ID',
  `title`              VARCHAR(255) NOT NULL COMMENT '单据标题',
  `initiator_id`       BIGINT       NOT NULL COMMENT '发起人 ID',
  `initiator_dept_id`  BIGINT       NULL COMMENT '发起人部门 ID（冗余，数据权限）',
  `current_node_order` INT          NULL COMMENT '当前节点顺序',
  `instance_status`    VARCHAR(16)  NOT NULL DEFAULT 'RUNNING' COMMENT 'DRAFT/RUNNING/APPROVED/REJECTED/CANCELED',
  `form_data`          JSON         NULL COMMENT '表单快照',
  `submit_time`        DATETIME     NULL COMMENT '提交时间',
  `end_time`           DATETIME     NULL COMMENT '结束时间',
  `version`            INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本',
  `created_by`         BIGINT       NULL COMMENT '创建人',
  `created_at`         DATETIME     NULL COMMENT '创建时间',
  `updated_by`         BIGINT       NULL COMMENT '更新人',
  `updated_at`         DATETIME     NULL COMMENT '更新时间',
  `deleted`            TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  KEY `idx_wf_inst_initiator` (`initiator_id`),
  KEY `idx_wf_inst_dept` (`initiator_dept_id`),
  KEY `idx_wf_inst_status` (`instance_status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '流程实例表';

CREATE TABLE IF NOT EXISTS `wf_process_task` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `instance_id`  BIGINT       NOT NULL COMMENT '流程实例 ID',
  `node_order`   INT          NOT NULL COMMENT '所属节点顺序',
  `node_name`    VARCHAR(128) NOT NULL COMMENT '节点名称快照',
  `assignee_id`  BIGINT       NOT NULL COMMENT '审批人 ID',
  `task_status`  VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/REJECTED/TRANSFERRED/CANCELED',
  `approve_time` DATETIME     NULL COMMENT '处理时间',
  `created_by`   BIGINT       NULL COMMENT '创建人',
  `created_at`   DATETIME     NULL COMMENT '创建时间',
  `updated_by`   BIGINT       NULL COMMENT '更新人',
  `updated_at`   DATETIME     NULL COMMENT '更新时间',
  `deleted`      TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  KEY `idx_wf_task_todo` (`assignee_id`, `task_status`),
  KEY `idx_wf_task_instance` (`instance_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '审批任务表';

CREATE TABLE IF NOT EXISTS `wf_process_record` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `instance_id`  BIGINT       NOT NULL COMMENT '流程实例 ID',
  `node_order`   INT          NULL COMMENT '节点顺序',
  `operator_id`  BIGINT       NOT NULL COMMENT '操作人 ID',
  `action`       VARCHAR(16)  NOT NULL COMMENT 'SUBMIT/APPROVE/REJECT/TRANSFER/ADD_SIGN/WITHDRAW',
  `comment`      VARCHAR(500) NULL COMMENT '审批意见（限长）',
  `operate_time` DATETIME     NULL COMMENT '操作时间',
  `created_by`   BIGINT       NULL COMMENT '创建人',
  `created_at`   DATETIME     NULL COMMENT '创建时间',
  `updated_by`   BIGINT       NULL COMMENT '更新人',
  `updated_at`   DATETIME     NULL COMMENT '更新时间',
  `deleted`      TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  KEY `idx_wf_record_instance` (`instance_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '审批记录表';

CREATE TABLE IF NOT EXISTS `wf_process_cc` (
  `id`          BIGINT   NOT NULL AUTO_INCREMENT COMMENT '主键',
  `instance_id` BIGINT   NOT NULL COMMENT '流程实例 ID',
  `user_id`     BIGINT   NOT NULL COMMENT '抄送人 ID',
  `read_flag`   TINYINT  NOT NULL DEFAULT 0 COMMENT '是否已读 0/1',
  `created_by`  BIGINT   NULL COMMENT '创建人',
  `created_at`  DATETIME NULL COMMENT '创建时间',
  `updated_by`  BIGINT   NULL COMMENT '更新人',
  `updated_at`  DATETIME NULL COMMENT '更新时间',
  `deleted`     TINYINT  NOT NULL DEFAULT 0 COMMENT '逻辑删除 0/1',
  PRIMARY KEY (`id`),
  KEY `idx_wf_cc_user` (`user_id`, `read_flag`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '抄送表';
