package com.rbac.system.log.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 操作日志注解：标注在 Controller 方法上，由 AOP 采集操作日志。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Log {

    /** 操作模块，如「用户管理」。 */
    String title() default "";

    /** 业务类型，如 CREATE/UPDATE/DELETE/GRANT。 */
    String businessType() default "OTHER";
}
