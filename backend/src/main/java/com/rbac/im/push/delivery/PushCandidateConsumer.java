package com.rbac.im.push.delivery;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.push.candidate.PushCandidate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.DltHandler;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.annotation.RetryableTopic;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.retry.annotation.Backoff;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;

@Service
@ConditionalOnProperty(prefix = "rbac.im.push", name = "enabled", havingValue = "true")
public class PushCandidateConsumer {

    private static final Logger log = LoggerFactory.getLogger(PushCandidateConsumer.class);

    private final ObjectMapper mapper;
    private final PushDeliveryService delivery;
    private final PushMetrics metrics;

    public PushCandidateConsumer(ObjectMapper mapper, PushDeliveryService delivery, PushMetrics metrics) {
        this.mapper = mapper;
        this.delivery = delivery;
        this.metrics = metrics;
    }

    @RetryableTopic(
            attempts = "4",
            backoff = @Backoff(delay = 1000, multiplier = 2.0, maxDelay = 30000, random = true),
            dltTopicSuffix = ".DLT")
    @KafkaListener(topics = ImKafkaTopics.PUSH, groupId = "im-push-delivery")
    public void onMessage(String json) throws JsonProcessingException {
        delivery.deliver(mapper.readValue(json, PushCandidate.class));
    }

    @DltHandler
    public void handleDlt(String json,
                          @Header(name = KafkaHeaders.DLT_EXCEPTION_MESSAGE, required = false) byte[] exceptionMessage) {
        String msgId = "UNKNOWN";
        try {
            msgId = mapper.readValue(json, PushCandidate.class).msgId();
        } catch (JsonProcessingException ignored) {
            // DLT 日志必须保持最小化，解析失败时不回显候选载荷。
        }
        onDlt(msgId, safeHeaderReason(exceptionMessage));
    }

    public void onDlt(String msgId, String reason) {
        String safeReason = PushMetrics.safeReason(reason);
        metrics.recordDlt(safeReason);
        log.warn("推送投递进入死信 msgId={} reason={}", msgId, safeReason);
    }

    private String safeHeaderReason(byte[] exceptionMessage) {
        if (exceptionMessage == null) {
            return "UNKNOWN";
        }
        String message = new String(exceptionMessage, StandardCharsets.UTF_8);
        for (String reason : new String[]{"UNREGISTERED", "UNAVAILABLE", "INTERNAL", "QUOTA_EXCEEDED",
                "INVALID_ARGUMENT", "SENDER_ID_MISMATCH", "THIRD_PARTY_AUTH_ERROR", "AUTHENTICATION_ERROR"}) {
            if (message.contains(reason)) {
                return reason;
            }
        }
        return "UNKNOWN";
    }
}
