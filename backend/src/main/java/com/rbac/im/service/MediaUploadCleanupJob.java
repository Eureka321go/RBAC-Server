package com.rbac.im.service;

import com.rbac.im.entity.ImMediaUpload;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/** 定期 abort 过期 Multipart 会话，避免 MinIO 长期保留临时分片。 */
@Component
public class MediaUploadCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(MediaUploadCleanupJob.class);

    private final MultipartMediaService service;

    public MediaUploadCleanupJob(MultipartMediaService service) {
        this.service = service;
    }

    @Scheduled(fixedDelayString = "${rbac.im.media.cleanup-delay-ms:300000}")
    public void cleanup() {
        for (ImMediaUpload row : service.findExpired(LocalDateTime.now())) {
            try {
                service.expire(row);
            } catch (RuntimeException cause) {
                log.warn("清理过期富媒体上传失败 taskId={}: {}", row.getTaskId(), cause.toString());
            }
        }
    }
}
