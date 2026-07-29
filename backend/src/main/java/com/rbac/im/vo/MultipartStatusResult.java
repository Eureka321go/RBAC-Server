package com.rbac.im.vo;

import java.util.List;

public record MultipartStatusResult(
        String taskId,
        String objectKey,
        String status,
        long partSize,
        int partCount,
        List<UploadedPartResult> uploadedParts
) {
}
