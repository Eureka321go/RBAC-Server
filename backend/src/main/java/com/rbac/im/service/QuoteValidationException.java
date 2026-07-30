package com.rbac.im.service;

/** 消息引用校验失败，reason 通过现有 ERROR 帧返回客户端。 */
public class QuoteValidationException extends RuntimeException {

    private final String reason;

    public QuoteValidationException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
