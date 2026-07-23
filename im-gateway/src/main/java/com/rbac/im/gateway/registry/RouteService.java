package com.rbac.im.gateway.registry;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/** Redis 路由：route:user:<userId> 为 Hash，field=deviceId，value=gatewayId，带 TTL 靠心跳续期。 */
@Component
public class RouteService {

    private static final String ROUTE_KEY = "route:user:";
    private static final long TTL_SECONDS = 120;

    private final StringRedisTemplate redis;
    private final String gatewayId;

    public RouteService(StringRedisTemplate redis,
                        @Value("${im.gateway.id}") String gatewayId) {
        this.redis = redis;
        this.gatewayId = gatewayId;
    }

    public void register(long userId, String deviceId) {
        String key = ROUTE_KEY + userId;
        redis.opsForHash().put(key, deviceId, gatewayId);
        redis.expire(key, TTL_SECONDS, TimeUnit.SECONDS);
    }

    public void unregister(long userId, String deviceId) {
        redis.opsForHash().delete(ROUTE_KEY + userId, deviceId);
    }

    public void renew(long userId) {
        redis.expire(ROUTE_KEY + userId, TTL_SECONDS, TimeUnit.SECONDS);
    }
}
