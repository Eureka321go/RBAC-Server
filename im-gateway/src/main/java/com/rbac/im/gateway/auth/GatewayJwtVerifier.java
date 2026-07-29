package com.rbac.im.gateway.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;

@Component
public class GatewayJwtVerifier {

    private static final String ACCESS_KEY = "auth:access:";

    private final SecretKey key;
    private final StringRedisTemplate redis;

    public GatewayJwtVerifier(@Value("${rbac.jwt.secret}") String secret,
                              StringRedisTemplate redis) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.redis = redis;
    }

    public AuthResult verify(String token) {
        if (token == null || token.isBlank()) {
            return AuthResult.fail("missing token");
        }
        try {
            Claims c = Jwts.parser().verifyWith(key).build()
                    .parseSignedClaims(token).getPayload();
            if (!"access".equals(c.get("typ", String.class))) {
                return AuthResult.fail("not access token");
            }
            String jti = c.getId();
            if (!Boolean.TRUE.equals(redis.hasKey(ACCESS_KEY + jti))) {
                return AuthResult.fail("session revoked");
            }
            return AuthResult.ok(Long.valueOf(c.getSubject()), jti);
        } catch (Exception e) {
            return AuthResult.fail("invalid token: " + e.getClass().getSimpleName());
        }
    }
}
