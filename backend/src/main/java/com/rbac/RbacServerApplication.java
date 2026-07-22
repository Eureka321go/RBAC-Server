package com.rbac;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * RBAC 权限管理系统 —— 后端服务启动类。
 *
 * <p>{@code @EnableAsync} 已下沉到 {@link com.rbac.common.config.AsyncConfig}。
 */
@SpringBootApplication
@MapperScan("com.rbac.**.mapper") //告诉框架"数据层类在哪"
public class RbacServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(RbacServerApplication.class, args);
    }
}
