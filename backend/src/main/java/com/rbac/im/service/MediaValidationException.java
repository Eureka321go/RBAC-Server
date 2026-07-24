package com.rbac.im.service;

/** 富媒体发送校验失败，携带回给客户端的 reason（INVALID_OBJECT / OBJECT_NOT_FOUND）。 */
public class MediaValidationException extends RuntimeException {

    private final String reason;

    public MediaValidationException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
