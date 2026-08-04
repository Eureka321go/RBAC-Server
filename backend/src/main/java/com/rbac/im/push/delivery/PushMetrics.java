package com.rbac.im.push.delivery;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Set;

@Component
public class PushMetrics {

    private static final Set<String> SAFE_REASONS = Set.of(
            "NONE", "UNREGISTERED", "UNAVAILABLE", "INTERNAL", "QUOTA_EXCEEDED",
            "INVALID_ARGUMENT", "SENDER_ID_MISMATCH", "THIRD_PARTY_AUTH_ERROR",
            "AUTHENTICATION_ERROR", "UNKNOWN");

    private final MeterRegistry registry;

    public PushMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    public void recordCandidateAccepted() {
        registry.counter("im.push.candidates", "result", "accepted").increment();
    }

    public void recordTargetsResolved(int count) {
        registry.counter("im.push.targets", "result", "resolved").increment(count);
    }

    public void recordDelivery(FcmSendResult result) {
        String deliveryResult = switch (result.failureKind()) {
            case NONE -> "success";
            case PERMANENT -> "permanent_failure";
            case TRANSIENT -> "transient_failure";
        };
        registry.counter("im.push.delivery", "result", deliveryResult,
                        "reason", safeReason(result.reason()))
                .increment();
    }

    public void recordLatency(Duration duration) {
        registry.timer("im.push.latency", "stage", "delivery").record(duration);
    }

    public void recordDlt(String reason) {
        registry.counter("im.push.dlt", "reason", safeReason(reason)).increment();
    }

    static String safeReason(String reason) {
        return reason != null && SAFE_REASONS.contains(reason) ? reason : "UNKNOWN";
    }
}
