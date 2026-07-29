package com.rbac.common.config;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * MyBatis-Plus 配置：注册分页插件与乐观锁插件。
 *
 * <p>乐观锁供工作流实例（{@code @Version}）在会签并发下防止节点重复推进；
 * 拦截器顺序遵循官方建议：乐观锁在分页之前。
 */
@Configuration
public class MybatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        // MybatisPlusInterceptor 是内置插件的统一入口，后续插件按添加顺序执行。
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

        // 更新带 @Version 的实体时追加版本条件，并在成功更新后递增版本号，防止并发覆盖。
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());

        // 将 MyBatis-Plus 的分页对象转换为 MySQL LIMIT 查询；分页插件按建议放在最后。
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
        return interceptor;
    }
}
