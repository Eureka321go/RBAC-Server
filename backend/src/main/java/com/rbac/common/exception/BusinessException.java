package com.rbac.common.exception;

import com.rbac.common.util.MessageUtils;
import lombok.Getter;

/**
 * 统一业务异常。code 复用 HTTP 语义，默认 400。
 *
 * <p>入参为国际化文案 key（见 {@code i18n/messages*.properties}），构造时按当前请求语言解析，
 * {@link #getMessage()} 返回已本地化的文案。若传入的不是已注册 key，则原样作为文案返回。
 */
@Getter
public class BusinessException extends RuntimeException {

    private final int code;

    /** 原始文案 key，便于日志排查与定位。 */
    private final String messageKey;

    public BusinessException(String messageKey, Object... args) {
        this(400, messageKey, args);
    }

    public BusinessException(int code, String messageKey, Object... args) {
        super(MessageUtils.get(messageKey, args));
        this.code = code;
        this.messageKey = messageKey;
    }
}
