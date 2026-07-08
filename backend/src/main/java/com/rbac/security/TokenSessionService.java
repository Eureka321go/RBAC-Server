package com.rbac.security;

import com.rbac.security.model.LoginUser;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

/**
 * Redis 会话管理：Access 会话保存 LoginUser（撤销即失效），Refresh 会话保存 userId。
 */
@Service
public class TokenSessionService {

    private static final String ACCESS_KEY = "auth:access:";
    private static final String REFRESH_KEY = "auth:refresh:";

    private final RedisTemplate<String, Object> redisTemplate;

    public TokenSessionService(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void saveAccessSession(String jti, LoginUser loginUser, long ttlSeconds) {
        redisTemplate.opsForValue().set(ACCESS_KEY + jti, loginUser, ttlSeconds, TimeUnit.SECONDS);
    }

    public LoginUser getAccessSession(String jti) {
        Object value = redisTemplate.opsForValue().get(ACCESS_KEY + jti);
        return value instanceof LoginUser loginUser ? loginUser : null;
    }

    public void removeAccessSession(String jti) {
        redisTemplate.delete(ACCESS_KEY + jti);
    }

    public void saveRefreshSession(String jti, Long userId, long ttlSeconds) {
        redisTemplate.opsForValue().set(REFRESH_KEY + jti, userId, ttlSeconds, TimeUnit.SECONDS);
    }

    public Long getRefreshUserId(String jti) {
        Object value = redisTemplate.opsForValue().get(REFRESH_KEY + jti);
        if (value == null) {
            return null;
        }
        return Long.valueOf(value.toString());
    }

    public void removeRefreshSession(String jti) {
        redisTemplate.delete(REFRESH_KEY + jti);
    }
}
