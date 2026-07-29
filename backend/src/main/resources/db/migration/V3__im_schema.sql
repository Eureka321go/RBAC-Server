CREATE TABLE `im_conversation` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cid` VARCHAR(64) NOT NULL COMMENT '会话ID：单聊 c_{minId}_{maxId}，群聊 g_{groupId}',
    `type` VARCHAR(16) NOT NULL COMMENT 'SINGLE / GROUP',
    `group_id` BIGINT NULL COMMENT '群聊时指向 im_group.id',
    `last_msg_seq` BIGINT NOT NULL DEFAULT 0,
    `last_msg_preview` VARCHAR(255) NULL,
    `created_by` BIGINT NULL, `created_at` DATETIME NULL,
    `updated_by` BIGINT NULL, `updated_at` DATETIME NULL,
    `deleted` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`), UNIQUE KEY `uk_cid` (`cid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 会话';

CREATE TABLE `im_conversation_member` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cid` VARCHAR(64) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `last_read_seq` BIGINT NOT NULL DEFAULT 0,
    `mention_seq` BIGINT NOT NULL DEFAULT 0,
    `muted` TINYINT NOT NULL DEFAULT 0,
    `created_by` BIGINT NULL, `created_at` DATETIME NULL,
    `updated_by` BIGINT NULL, `updated_at` DATETIME NULL,
    `deleted` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`), UNIQUE KEY `uk_cid_user` (`cid`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 会话成员';

CREATE TABLE `im_group` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `created_by` BIGINT NULL, `created_at` DATETIME NULL,
    `updated_by` BIGINT NULL, `updated_at` DATETIME NULL,
    `deleted` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 群';

CREATE TABLE `im_group_member` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `group_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'MEMBER' COMMENT 'OWNER / ADMIN / MEMBER',
    `created_by` BIGINT NULL, `created_at` DATETIME NULL,
    `updated_by` BIGINT NULL, `updated_at` DATETIME NULL,
    `deleted` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`), UNIQUE KEY `uk_group_user` (`group_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 群成员';
