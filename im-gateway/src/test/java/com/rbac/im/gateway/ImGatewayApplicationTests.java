package com.rbac.im.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@TestPropertySource(properties = {
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration,org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration,org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration",
        "im.gateway.ws-port=0"
})
class ImGatewayApplicationTests {

    // 排除了 Redis/Kafka 自动装配（无需真实中间件即可验证上下文加载），
    // 故为依赖它们的组件（GatewayJwtVerifier/RouteService/InboundProducer）补 mock bean。
    @MockitoBean
    private StringRedisTemplate stringRedisTemplate;

    @MockitoBean
    private KafkaTemplate<String, String> kafkaTemplate;

    @Test
    void contextLoads() {
    }
}
