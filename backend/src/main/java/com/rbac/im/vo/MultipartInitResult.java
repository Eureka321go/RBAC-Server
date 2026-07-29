package com.rbac.im.vo;

public record MultipartInitResult(
        String taskId,
        String objectKey,
        long partSize,
        int partCount,
        long expiresAt
) {
}
