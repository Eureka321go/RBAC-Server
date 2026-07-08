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
