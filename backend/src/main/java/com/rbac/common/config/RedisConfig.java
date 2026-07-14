package com.rbac.common.config;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.jsontype.BasicPolymorphicTypeValidator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;

/**
 * Redis 配置：key 用 String，value 用 JSON（保留类型信息，便于反序列化 LoginUser）。
 */
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory) {
        // value 需要同时支持 LoginUser、Long 等多种类型，因此模板的 value 泛型使用 Object。
        RedisTemplate<String, Object> template = new RedisTemplate<>();

        // 连接工厂由 Spring Boot 根据 spring.data.redis 配置自动创建。
        template.setConnectionFactory(connectionFactory);

        // 单独创建 ObjectMapper，避免修改 Spring MVC 全局 JSON 序列化规则。
        ObjectMapper mapper = new ObjectMapper();

        // Redis 中的对象可能包含非 public 字段，允许 Jackson 直接发现并序列化这些字段。
        mapper.setVisibility(PropertyAccessor.ALL, JsonAutoDetect.Visibility.ANY);

        // RedisTemplate 的 value 声明为 Object，必须写入类型信息才能还原为原始 Java 类型。
        // 多态类型白名单限制反序列化范围，避免 Redis 数据指定任意危险类型。
        mapper.activateDefaultTyping(
                BasicPolymorphicTypeValidator.builder()
                        // 项目领域对象，例如登录用户 LoginUser。
                        .allowIfSubType("com.rbac")
                        // 集合、基础包装类型以及日期时间类型。
                        .allowIfSubType("java.util")
                        .allowIfSubType("java.lang")
                        .allowIfSubType("java.time")
                        .build(),
                // 仅为无法从声明推断具体实现类的非 final 类型保存类型信息。
                ObjectMapper.DefaultTyping.NON_FINAL);

        // 使用配置好的 ObjectMapper，把普通 value 和 Hash value 保存为带类型信息的 JSON。
        GenericJackson2JsonRedisSerializer jsonSerializer = new GenericJackson2JsonRedisSerializer(mapper);

        // key 固定使用字符串序列化，保证 Redis 中的键可读且不会出现 Java 二进制前缀。
        StringRedisSerializer stringSerializer = new StringRedisSerializer();
        template.setKeySerializer(stringSerializer);
        template.setHashKeySerializer(stringSerializer);

        // 普通键值和 Hash 的值使用相同 JSON 规则，避免同一模板产生两套数据格式。
        template.setValueSerializer(jsonSerializer);
        template.setHashValueSerializer(jsonSerializer);

        // 所有属性设置完成后执行模板初始化和必要的配置检查。
        template.afterPropertiesSet();
        return template;
    }
}
