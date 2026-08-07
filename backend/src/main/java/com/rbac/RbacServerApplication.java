package com.rbac;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * RBAC 权限管理系统 —— 后端服务启动类。
 *
 * <p>{@code @EnableAsync} 已下沉到 {@link com.rbac.common.config.AsyncConfig}。
 *
 * <p>{@code @ConfigurationPropertiesScan} 扫描并注册所有 {@code @ConfigurationProperties}
 * 类（如 {@link com.rbac.common.config.RbacProperties}），无需逐个 {@code @EnableConfigurationProperties}。
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
@MapperScan({"com.rbac.**.mapper", "com.rbac.im.push.registration"}) //告诉框架"数据层类在哪"
public class RbacServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(RbacServerApplication.class, args);
    }
}
