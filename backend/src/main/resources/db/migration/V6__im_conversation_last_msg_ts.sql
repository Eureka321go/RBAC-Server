ALTER TABLE `im_conversation`
    ADD COLUMN `last_msg_ts` BIGINT NOT NULL DEFAULT 0 AFTER `last_msg_preview`;

UPDATE `im_conversation`
SET `last_msg_ts` = UNIX_TIMESTAMP(`updated_at`) * 1000
WHERE `last_msg_seq` > 0
  AND `updated_at` IS NOT NULL
  AND `last_msg_ts` = 0;
