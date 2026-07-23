package com.rbac.im.gateway.auth;

public record AuthResult(boolean ok, Long userId, String jti, String reason) {
    public static AuthResult ok(Long userId, String jti) {
        return new AuthResult(true, userId, jti, null);
    }
    public static AuthResult fail(String reason) {
        return new AuthResult(false, null, null, reason);
    }
}
