package com.rbac.im.vo;

public record DownloadPresignResult(String objectKey, String url, long expiresIn) {
}
