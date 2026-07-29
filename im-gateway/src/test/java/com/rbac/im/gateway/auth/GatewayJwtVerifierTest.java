package com.rbac.im.gateway.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GatewayJwtVerifierTest {

    private static final String SECRET = "test-secret-test-secret-test-secret-32";

    private String token(String jti, long userId, String typ, long ttlMillis) {
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        Date now = new Date();
        return Jwts.builder().id(jti).subject(String.valueOf(userId))
                .claim("typ", typ).issuedAt(now)
                .expiration(new Date(now.getTime() + ttlMillis))
                .signWith(key).compact();
    }

    @Test
    void valid_access_token_with_live_session_passes() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.hasKey("auth:access:jti1")).thenReturn(true);
        GatewayJwtVerifier v = new GatewayJwtVerifier(SECRET, redis);

        AuthResult r = v.verify(token("jti1", 7L, "access", 60_000));
        assertTrue(r.ok());
        assertEquals(7L, r.userId());
    }

    @Test
    void revoked_session_fails() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.hasKey("auth:access:jti1")).thenReturn(false);
        GatewayJwtVerifier v = new GatewayJwtVerifier(SECRET, redis);

        assertFalse(v.verify(token("jti1", 7L, "access", 60_000)).ok());
    }

    @Test
    void wrong_type_or_bad_signature_fails() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.hasKey(anyString())).thenReturn(true);
        GatewayJwtVerifier v = new GatewayJwtVerifier(SECRET, redis);

        assertFalse(v.verify(token("jti1", 7L, "refresh", 60_000)).ok());
        assertFalse(v.verify("garbage.token.value").ok());
    }
}
