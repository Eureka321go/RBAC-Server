ALTER TABLE `sys_user`
    ADD COLUMN `profile` VARCHAR(500) NULL COMMENT '个人简介' AFTER `remark`;