package com.rbac.controller;

import com.rbac.common.Result;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 探活接口 —— 验证服务、MySQL、Redis 是否打通。
 */
@RestController
@RequestMapping("/ping")
@RequiredArgsConstructor
public class PingController {

    private final JdbcTemplate jdbcTemplate;
    private final StringRedisTemplate redisTemplate;

    @GetMapping
    public Result<Map<String, Object>> ping() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("app", "rbac-server");
        body.put("time", LocalDateTime.now().toString());

        // MySQL 连通性
        try {
            Integer one = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            body.put("mysql", one != null && one == 1 ? "UP" : "DOWN");
        } catch (Exception e) {
            body.put("mysql", "DOWN: " + e.getMessage());
        }

        // Redis 连通性
        try {
            redisTemplate.opsForValue().set("rbac:ping", "pong");
            body.put("redis", "pong".equals(redisTemplate.opsForValue().get("rbac:ping")) ? "UP" : "DOWN");
            redisTemplate.delete("rbac:ping");
        } catch (Exception e) {
            body.put("redis", "DOWN: " + e.getMessage());
        }

        return Result.success(body);
    }
}
