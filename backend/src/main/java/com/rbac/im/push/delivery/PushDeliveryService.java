package com.rbac.im.push.delivery;

import com.rbac.im.push.candidate.PushCandidate;
import com.rbac.im.push.registration.ImPushRegistration;
import com.rbac.im.push.registration.PushRegistrationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@ConditionalOnProperty(prefix = "rbac.im.push", name = "enabled", havingValue = "true")
public class PushDeliveryService {

    private static final Logger log = LoggerFactory.getLogger(PushDeliveryService.class);
    private static final int MAX_BATCH_SIZE = 500;

    private final PushRecipientResolver resolver;
    private final PushPresentationService presentations;
    private final FcmPayloadFactory payloadFactory;
    private final FcmGateway gateway;
    private final PushRegistrationService registrations;
    private final PushMetrics metrics;

    public PushDeliveryService(PushRecipientResolver resolver,
                               PushPresentationService presentations,
                               FcmPayloadFactory payloadFactory,
                               FcmGateway gateway,
                               PushRegistrationService registrations,
                               PushMetrics metrics) {
        this.resolver = resolver;
        this.presentations = presentations;
        this.payloadFactory = payloadFactory;
        this.gateway = gateway;
        this.registrations = registrations;
        this.metrics = metrics;
    }

    public void deliver(PushCandidate candidate) {
        long startedNanos = System.nanoTime();
        metrics.recordCandidateAccepted();
        try {
            List<PushTarget> targets = resolver.resolve(candidate);
            metrics.recordTargetsResolved(targets.size());
            if (targets.isEmpty()) {
                return;
            }

            PushPresentation presentation = presentations.resolve(candidate);
            List<FcmRequest> requests = requests(candidate, presentation, targets);
            String transientReason = null;
            for (int offset = 0; offset < requests.size(); offset += MAX_BATCH_SIZE) {
                int end = Math.min(offset + MAX_BATCH_SIZE, requests.size());
                List<FcmRequest> batch = requests.subList(offset, end);
                String batchTransientReason = processBatch(batch, gateway.send(batch));
                if (transientReason == null) {
                    transientReason = batchTransientReason;
                }
            }
            if (transientReason != null) {
                log.warn("推送投递失败 msgId={} reason={}",
                        PushCandidateConsumer.safeMsgId(candidate.msgId()), transientReason);
                throw new TransientPushException(transientReason);
            }
        } finally {
            metrics.recordLatency(Duration.ofNanos(System.nanoTime() - startedNanos));
        }
    }

    private List<FcmRequest> requests(PushCandidate candidate,
                                      PushPresentation presentation,
                                      List<PushTarget> targets) {
        List<FcmRequest> requests = new ArrayList<>(targets.size());
        for (PushTarget target : targets) {
            ImPushRegistration registration = target.registration();
            Map<String, String> data = payloadFactory.create(candidate, target, presentation);
            requests.add(new FcmRequest(
                    registration.getTargetType(), registration.getTargetValue(), registration.getTargetHash(), data));
        }
        return List.copyOf(requests);
    }

    private String processBatch(List<FcmRequest> requests, List<FcmSendResult> results) {
        if (results == null || results.size() != requests.size()) {
            FcmSendResult failure = new FcmSendResult(false, PushFailureKind.TRANSIENT, "INTERNAL");
            metrics.recordDelivery(failure);
            return failure.reason();
        }

        String transientReason = null;
        for (int index = 0; index < results.size(); index++) {
            FcmSendResult result = normalized(results.get(index));
            metrics.recordDelivery(result);
            if (result.failureKind() == PushFailureKind.PERMANENT) {
                registrations.disableTargetHash(requests.get(index).targetHash());
            } else if (result.failureKind() == PushFailureKind.TRANSIENT && transientReason == null) {
                transientReason = result.reason();
            }
        }
        return transientReason;
    }

    private FcmSendResult normalized(FcmSendResult result) {
        if (result == null || result.failureKind() == null
                || result.success() != (result.failureKind() == PushFailureKind.NONE)) {
            return new FcmSendResult(false, PushFailureKind.TRANSIENT, "INTERNAL");
        }
        return new FcmSendResult(result.success(), result.failureKind(), PushMetrics.safeReason(result.reason()));
    }
}
