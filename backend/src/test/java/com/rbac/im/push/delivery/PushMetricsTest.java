package com.rbac.im.push.delivery;

import io.micrometer.core.instrument.Meter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class PushMetricsTest {

    @Test
    void metricsUseOnlyDocumentedLowCardinalityTags() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        PushMetrics metrics = new PushMetrics(registry);

        metrics.recordCandidateAccepted();
        metrics.recordTargetsResolved(3);
        metrics.recordDelivery(FcmSendResult.delivered());
        metrics.recordDelivery(new FcmSendResult(false, PushFailureKind.PERMANENT, "secret target value"));
        metrics.recordLatency(Duration.ofMillis(12));
        metrics.recordDlt("arbitrary exception text");

        assertThat(registry.getMeters()).extracting(meter -> meter.getId().getName())
                .contains("im.push.candidates", "im.push.targets", "im.push.delivery", "im.push.latency", "im.push.dlt");
        assertThat(registry.get("im.push.delivery").tag("result", "permanent_failure")
                .tag("reason", "UNKNOWN").counter().count()).isEqualTo(1);
        assertThat(registry.get("im.push.dlt").tag("reason", "UNKNOWN").counter().count()).isEqualTo(1);
        assertThat(registry.getMeters()).allSatisfy(meter ->
                assertThat(meter.getId().getTags()).extracting(tag -> tag.getKey())
                        .allMatch(Set.of("result", "reason", "stage")::contains));
        assertThat(registry.getMeters()).flatExtracting(meter -> meter.getId().getTags())
                .extracting(tag -> tag.getValue())
                .doesNotContain("secret target value", "arbitrary exception text");
    }

    @Test
    void zeroTargetsStillCreatesResolvedCounterWithoutIncrementingIt() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        PushMetrics metrics = new PushMetrics(registry);

        metrics.recordTargetsResolved(0);

        Meter meter = registry.get("im.push.targets").tag("result", "resolved").meter();
        assertThat(meter.measure()).extracting(measurement -> measurement.getValue()).containsOnly(0.0);
    }
}
