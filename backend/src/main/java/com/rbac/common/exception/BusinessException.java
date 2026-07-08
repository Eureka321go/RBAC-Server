package com.rbac.common.exception;

import lombok.Getter;

/**
 * 统一业务异常。code 复用 HTTP 语义，默认 400。
 */
@Getter
public class BusinessException extends RuntimeException {

    private final int code;

    public BusinessException(String message) {
        this(400, message);
    }

    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }
}
