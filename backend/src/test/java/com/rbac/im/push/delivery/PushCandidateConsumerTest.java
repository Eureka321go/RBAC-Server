package com.rbac.im.push.delivery;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.rbac.im.push.candidate.PushCandidate;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.annotation.EnableKafkaRetryTopic;
import org.springframework.kafka.annotation.RetryableTopic;
import org.springframework.retry.annotation.Backoff;

import java.lang.reflect.Method;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;

class PushCandidateConsumerTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final PushDeliveryService delivery = mock(PushDeliveryService.class);
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final PushCandidateConsumer consumer = new PushCandidateConsumer(mapper, delivery, new PushMetrics(registry));

    @Test
    void transientFailureEscapesListenerForRetry() throws Exception {
        PushCandidate candidate = candidate();
        doThrow(new TransientPushException("UNAVAILABLE")).when(delivery).deliver(candidate);

        assertThatThrownBy(() -> consumer.onMessage(mapper.writeValueAsString(candidate)))
                .isInstanceOf(TransientPushException.class)
                .hasMessage("UNAVAILABLE");
    }

    @Test
    void listenerUsesFourAttemptsRandomExponentialBackoffAndDedicatedGroup() throws Exception {
        Method listenerMethod = PushCandidateConsumer.class.getMethod("onMessage", String.class);
        RetryableTopic retry = listenerMethod.getAnnotation(RetryableTopic.class);
        KafkaListener listener = listenerMethod.getAnnotation(KafkaListener.class);
        Backoff backoff = retry.backoff();

        assertThat(retry.attempts()).isEqualTo("4");
        assertThat(retry.dltTopicSuffix()).isEqualTo(".DLT");
        assertThat(backoff.delay()).isEqualTo(1000L);
        assertThat(backoff.multiplier()).isEqualTo(2.0);
        assertThat(backoff.maxDelay()).isEqualTo(30000L);
        assertThat(backoff.random()).isTrue();
        assertThat(listener.groupId()).isEqualTo("im-push-delivery");
        assertThat(FirebaseAdminConfig.class).hasAnnotation(EnableKafkaRetryTopic.class);
    }

    @Test
    void dltRecordsFailureWithoutPayloadText() {
        consumer.onDlt("msg-1", "UNAVAILABLE");

        assertThat(registry.get("im.push.dlt").tag("reason", "UNAVAILABLE").counter().count()).isEqualTo(1);
    }

    @Test
    void dltHandlerExtractsOnlyMsgIdAndWhitelistedReason() throws Exception {
        consumer.handleDlt(mapper.writeValueAsString(candidate()),
                "provider details: INTERNAL".getBytes(StandardCharsets.UTF_8));

        assertThat(registry.get("im.push.dlt").tag("reason", "INTERNAL").counter().count()).isEqualTo(1);
    }

    @Test
    void dltHandlerUsesUnknownForMalformedPayloadAndMissingExceptionHeader() {
        consumer.handleDlt("not-json", null);

        assertThat(registry.get("im.push.dlt").tag("reason", "UNKNOWN").counter().count()).isEqualTo(1);
    }

    @Test
    void malformedCandidateEscapesAsJsonFailureWithoutCallingDelivery() {
        assertThatThrownBy(() -> consumer.onMessage("not-json"))
                .isInstanceOf(JsonProcessingException.class);
        verify(delivery, org.mockito.Mockito.never()).deliver(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void pushDisabledByDefaultDoesNotCreateFirebaseDeliveryChain() {
        new ApplicationContextRunner()
                .withUserConfiguration(FirebaseAdminConfig.class, FirebaseAdminFcmGateway.class,
                        PushDeliveryService.class, PushCandidateConsumer.class)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).doesNotHaveBean(FirebaseApp.class);
                    assertThat(context).doesNotHaveBean(FcmGateway.class);
                    assertThat(context).doesNotHaveBean(PushDeliveryService.class);
                    assertThat(context).doesNotHaveBean(PushCandidateConsumer.class);
                });
    }

    @Test
    void firebaseAdminInitializationUsesAdcAndRedactsCredentialFailure() {
        FirebaseAdminConfig config = new FirebaseAdminConfig();
        try (org.mockito.MockedStatic<GoogleCredentials> credentials = mockStatic(GoogleCredentials.class)) {
            credentials.when(GoogleCredentials::getApplicationDefault)
                    .thenThrow(new IOException("sensitive credential path"));

            assertThatThrownBy(config::firebaseApp)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("Firebase Admin initialization failed")
                    .hasNoCause();
        }
    }

    @Test
    void pushPropertiesRejectNonPositiveFreshnessAndTtl() {
        assertThatThrownBy(() -> new PushProperties(true, 0, 60))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("freshDays must be positive");
        assertThatThrownBy(() -> new PushProperties(true, 30, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("ttlSeconds must be positive");
    }

    private PushCandidate candidate() {
        return new PushCandidate(1, "msg-1", "g_100", 86L, 10L, "TEXT", "安全预览", List.of(), 123L);
    }
}
