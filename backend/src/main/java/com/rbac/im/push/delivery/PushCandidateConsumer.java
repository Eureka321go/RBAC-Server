package com.rbac.im.push.delivery;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.push.candidate.PushCandidate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.DltHandler;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.annotation.RetryableTopic;
import org.springframework.kafka.retrytopic.DltStrategy;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.retry.annotation.Backoff;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.regex.Pattern;

@Service
@ConditionalOnProperty(prefix = "rbac.im.push", name = "enabled", havingValue = "true")
public class PushCandidateConsumer {

    private static final Logger log = LoggerFactory.getLogger(PushCandidateConsumer.class);
    private static final Pattern SAFE_MSG_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}");
    private static final Set<String> PUSH_TYPES = Set.of("TEXT", "IMAGE", "AUDIO", "FILE");

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
            dltTopicSuffix = ".DLT",
            dltStrategy = DltStrategy.FAIL_ON_ERROR)
    @KafkaListener(topics = ImKafkaTopics.PUSH, groupId = "im-push-delivery")
    public void onMessage(String json) {
        PushCandidate candidate;
        try {
            candidate = mapper.readValue(json, PushCandidate.class);
        } catch (Exception ignored) {
            throw invalidCandidate();
        }
        if (!isValidCandidate(candidate)) {
            throw invalidCandidate();
        }
        delivery.deliver(candidate);
    }

    @DltHandler
    public void handleDlt(String json,
                          @Header(name = KafkaHeaders.EXCEPTION_MESSAGE, required = false) byte[] exceptionMessage) {
        try {
            String msgId = "UNKNOWN";
            if (json != null) {
                PushCandidate candidate = mapper.readValue(json, PushCandidate.class);
                if (candidate != null) {
                    msgId = safeMsgId(candidate.msgId());
                }
            }
            onDlt(msgId, safeHeaderReason(exceptionMessage));
        } catch (Exception ignored) {
            try {
                onDlt("UNKNOWN", safeHeaderReason(exceptionMessage));
            } catch (RuntimeException ignoredAgain) {
                // DLT handler 必须是 total function，避免处理失败导致死信无限回投。
            }
        }
    }

    public void onDlt(String msgId, String reason) {
        String safeMsgId = safeMsgId(msgId);
        String safeReason = PushMetrics.safeReason(reason);
        metrics.recordDlt(safeReason);
        log.warn("推送投递进入死信 msgId={} reason={}", safeMsgId, safeReason);
    }

    static String safeMsgId(String msgId) {
        return isSafeMsgId(msgId) ? msgId : "UNKNOWN";
    }

    private static boolean isSafeMsgId(String msgId) {
        return msgId != null && SAFE_MSG_ID.matcher(msgId).matches();
    }

    private static boolean isValidCandidate(PushCandidate candidate) {
        return candidate != null
                && candidate.version() == 1
                && isSafeMsgId(candidate.msgId())
                && isSafeMsgId(candidate.cid())
                && candidate.seq() > 0
                && candidate.senderId() > 0
                && PUSH_TYPES.contains(candidate.type())
                && candidate.preview() != null
                && candidate.preview().codePointCount(0, candidate.preview().length()) <= 120
                && candidate.mentionTargetIds() != null
                && candidate.mentionTargetIds().stream().allMatch(id -> id != null && id > 0)
                && candidate.ts() > 0;
    }

    private IllegalArgumentException invalidCandidate() {
        return new IllegalArgumentException("Invalid push candidate");
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
