package com.rbac.im.vo;

public record UploadPartPresignResult(int partNumber, String uploadUrl, long expiresIn) {
}
