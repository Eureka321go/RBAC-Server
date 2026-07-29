ALTER TABLE `im_group_member`
    ADD COLUMN `muted` TINYINT NOT NULL DEFAULT 0 COMMENT '群级禁言：1=被管理员禁言，发送时拦截';
