package com.rbac.common.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.aop.interceptor.AsyncUncaughtExceptionHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.AsyncConfigurer;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.Arrays;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * 异步执行配置：为操作日志/登录日志的落库单独配一个线程池，与业务主流程隔离。
 *
 * <p>日志写入是「可容忍延迟、不能拖慢主流程」的旁路任务，因此：
 * <ul>
 *   <li>独立线程池，日志洪峰不会占满 Spring 默认线程资源；</li>
 *   <li>有界队列 + {@link ThreadPoolExecutor.CallerRunsPolicy} 拒绝策略：队列打满时退回调用线程同步执行，
 *       宁可短暂变慢也不丢审计日志；</li>
 *   <li>自定义线程名前缀 {@code op-log-}，便于在日志/线程 dump 中定位；</li>
 *   <li>{@link AsyncUncaughtExceptionHandler} 兜住 void @Async 方法抛出的异常，避免静默丢失。</li>
 * </ul>
 *
 * <p>{@code @EnableAsync} 从启动类移到此处，配置更内聚。
 */
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {

    private static final Logger log = LoggerFactory.getLogger(AsyncConfig.class);

    /** 日志线程池 Bean 名称；{@code @Async} 通过该名称精确指向此执行器。 */
    public static final String LOG_EXECUTOR = "logTaskExecutor";

    /**
     * 操作日志专用线程池。
     *
     * <p>核心 2 / 最大 4 / 队列 512：日志量平时不大，突发时先排队，仍撑不住才退回调用线程。
     */
    @Bean(name = LOG_EXECUTOR)
    public Executor logTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(512);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("op-log-");
        // 队列满且线程用尽时，退回调用线程同步执行，保证审计日志不丢。
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        // 优雅停机：关闭时等待在途日志写完，最多等 10 秒。
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        executor.initialize();
        return executor;
    }

    /**
     * 默认异步执行器：无名 {@code @Async} 也复用日志线程池。
     * 当前全项目仅日志用到 {@code @Async}，如后续新增其它异步场景应显式指定各自的执行器。
     */
    @Override
    public Executor getAsyncExecutor() {
        return logTaskExecutor();
    }

    /**
     * 兜底处理 void 返回的 {@code @Async} 方法中未捕获的异常：仅记录日志，不影响主流程。
     */
    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (throwable, method, params) ->
                log.error("异步日志任务执行失败: method={}, params={}",
                        method.getName(), Arrays.toString(params), throwable);
    }
}
