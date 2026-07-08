package com.rbac;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * RBAC 权限管理系统 —— 后端服务启动类。
 */
@SpringBootApplication
@EnableAsync
@MapperScan("com.rbac.**.mapper")
public class RbacServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(RbacServerApplication.class, args);
    }
}
