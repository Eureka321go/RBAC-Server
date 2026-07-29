package com.rbac.common.observability;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class WorkflowMetricsTest {

    @Test
    void recordApproveIncrementsSuccessCounterAndTimer() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        WorkflowMetrics metrics = new WorkflowMetrics(registry);

        metrics.recordApprove(true, 12);

        assertThat(registry.get("workflow.approve").tag("result", "success").counter().count())
                .isEqualTo(1.0);
        assertThat(registry.get("workflow.approve.duration").timer().count())
                .isEqualTo(1L);
    }

    @Test
    void recordApproveIncrementsFailCounter() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        WorkflowMetrics metrics = new WorkflowMetrics(registry);

        metrics.recordApprove(false, 3);

        assertThat(registry.get("workflow.approve").tag("result", "fail").counter().count())
                .isEqualTo(1.0);
    }
}
