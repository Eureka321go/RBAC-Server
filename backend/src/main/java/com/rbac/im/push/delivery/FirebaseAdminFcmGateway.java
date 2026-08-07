package com.rbac.im.push.delivery;

import com.google.firebase.messaging.AndroidConfig;
import com.google.firebase.messaging.BatchResponse;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.MessagingErrorCode;
import com.google.firebase.messaging.SendResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
@ConditionalOnProperty(prefix = "rbac.im.push", name = "enabled", havingValue = "true")
public class FirebaseAdminFcmGateway implements FcmGateway {

    private static final Logger log = LoggerFactory.getLogger(FirebaseAdminFcmGateway.class);
    private static final int MAX_BATCH_SIZE = 500;

    private final ObjectProvider<FirebaseMessaging> messagingProvider;
    private final PushProperties properties;

    public FirebaseAdminFcmGateway(ObjectProvider<FirebaseMessaging> messagingProvider, PushProperties properties) {
        this.messagingProvider = messagingProvider;
        this.properties = properties;
    }

    @Override
    public List<FcmSendResult> send(List<FcmRequest> requests) {
        if (requests.size() > MAX_BATCH_SIZE) {
            throw new IllegalArgumentException("FCM batch exceeds 500 messages");
        }
        List<Message> messages = requests.stream().map(this::message).toList();
        try {
            BatchResponse response = messagingProvider.getObject().sendEach(messages);
            List<FcmSendResult> results = response.getResponses().stream().map(this::result).toList();
            long delivered = results.stream().filter(FcmSendResult::success).count();
            if (delivered != results.size()) {
                log.warn("FCM batch completed delivered={} failed={}", delivered, results.size() - delivered);
            } else {
                log.info("FCM batch delivered count={}", delivered);
            }
            return results;
        } catch (FirebaseMessagingException exception) {
            FcmSendResult result = failure(exception.getMessagingErrorCode());
            log.warn("FCM batch request failed reason={}", result.reason());
            return new ArrayList<>(java.util.Collections.nCopies(requests.size(), result));
        } catch (RuntimeException exception) {
            log.warn("FCM batch request failed reason=INTERNAL");
            return failures(requests.size(), "INTERNAL");
        }
    }

    @SuppressWarnings("deprecation") // TOKEN 是旧登记的兼容路径；新登记默认使用 FID。
    private Message message(FcmRequest request) {
        Message.Builder builder = Message.builder()
                .setAndroidConfig(AndroidConfig.builder()
                        .setPriority(AndroidConfig.Priority.HIGH)
                        .setTtl(Math.multiplyExact(properties.ttlSeconds(), 1000L))
                        .putAllData(request.data())
                        .build());
        if ("TOKEN".equals(request.targetType())) {
            builder.setToken(request.targetValue());
        } else if ("FID".equals(request.targetType())) {
            builder.setFid(request.targetValue());
        } else {
            throw new IllegalArgumentException("Unsupported FCM target type");
        }
        return builder.build();
    }

    private FcmSendResult result(SendResponse response) {
        return response.isSuccessful() ? FcmSendResult.delivered() : failure(response.getException().getMessagingErrorCode());
    }

    private FcmSendResult failure(MessagingErrorCode errorCode) {
        String reason = errorCode == null ? "UNKNOWN" : PushMetrics.safeReason(errorCode.name());
        PushFailureKind kind = errorCode == MessagingErrorCode.UNREGISTERED
                || errorCode == MessagingErrorCode.SENDER_ID_MISMATCH
                ? PushFailureKind.PERMANENT
                : PushFailureKind.TRANSIENT;
        return new FcmSendResult(false, kind, reason);
    }

    private List<FcmSendResult> failures(int size, String reason) {
        FcmSendResult result = new FcmSendResult(false, PushFailureKind.TRANSIENT, reason);
        return new ArrayList<>(java.util.Collections.nCopies(size, result));
    }
}
