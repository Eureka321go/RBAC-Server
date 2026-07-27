package com.rbac.im.service;

/**
 * @提及 校验失败，携带回给客户端的 reason：
 * MENTION_NOT_MEMBER（@到非会话成员）/ MENTION_ALL_FORBIDDEN（非群主·管理员 @所有人）。
 */
public class MentionValidationException extends RuntimeException {

    private final String reason;

    public MentionValidationException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}
