package com.rbac.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

/**
 * JWT 令牌生成与解析。Access / Refresh 均携带 jti，用于 Redis 会话关联与撤销。
 */
@Component
public class JwtTokenProvider {

    public static final String TYPE_ACCESS = "access";
    public static final String TYPE_REFRESH = "refresh";

    private final SecretKey key;
    private final long accessTtlSeconds;
    private final long refreshTtlSeconds;

    public JwtTokenProvider(
            @Value("${rbac.jwt.secret}") String secret,
            @Value("${rbac.jwt.access-ttl}") long accessTtlSeconds,
            @Value("${rbac.jwt.refresh-ttl}") long refreshTtlSeconds) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTtlSeconds = accessTtlSeconds;
        this.refreshTtlSeconds = refreshTtlSeconds;
    }

    public long getAccessTtlSeconds() {
        return accessTtlSeconds;
    }

    public long getRefreshTtlSeconds() {
        return refreshTtlSeconds;
    }

    /** 生成 token，jti 由外部传入以便与 Redis 会话关联。 */
    public String createToken(String jti, Long userId, String username, String type, long ttlSeconds) {
        Date now = new Date();
        Date exp = new Date(now.getTime() + ttlSeconds * 1000);
        return Jwts.builder()
                .id(jti)
                .subject(String.valueOf(userId))
                .claim("username", username)
                .claim("typ", type)
                .issuedAt(now)
                .expiration(exp)
                .signWith(key)
                .compact();
    }

    public String createAccessToken(String jti, Long userId, String username) {
        return createToken(jti, userId, username, TYPE_ACCESS, accessTtlSeconds);
    }

    public String createRefreshToken(String jti, Long userId, String username) {
        return createToken(jti, userId, username, TYPE_REFRESH, refreshTtlSeconds);
    }

    public static String newJti() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    /** 解析并校验签名/过期，返回 Claims；无效则抛异常。 */
    public Claims parse(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }
}
