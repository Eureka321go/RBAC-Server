package com.rbac.im.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 服务端持久化的 S3 Multipart 上传会话。 */
@Data
@TableName("im_media_upload")
public class ImMediaUpload {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String taskId;
    private Long ownerId;
    private String cid;
    private String messageType;
    private String filename;
    private String mime;
    private Long totalSize;
    private Long partSize;
    private String objectKey;
    private String uploadId;
    private String status;
    private LocalDateTime expiresAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
