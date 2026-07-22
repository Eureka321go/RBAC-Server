package com.rbac.common.observability;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/**
 * 工作流审批业务指标:成功/失败计数 + 审批耗时,供 Actuator/Prometheus 暴露。
 * 只记录聚合指标,不含任何敏感参数。
 */
@Component
public class WorkflowMetrics {

    private final MeterRegistry registry;

    public WorkflowMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    /** 计时用采样,在业务方法开始时创建。 */
    public Timer.Sample startSample() {
        return Timer.start(registry);
    }

    /** 记录一次审批结果与耗时(毫秒)。 */
    public void recordApprove(boolean success, long millis) {
        registry.counter("workflow.approve", "result", success ? "success" : "fail").increment();
        registry.timer("workflow.approve.duration").record(millis, TimeUnit.MILLISECONDS);
    }

    /** 记录一次登录结果。 */
    public void recordLogin(boolean success) {
        registry.counter("auth.login", "result", success ? "success" : "fail").increment();
    }
}
