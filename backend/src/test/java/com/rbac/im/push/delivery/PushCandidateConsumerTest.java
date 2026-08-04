package com.rbac.im.push.delivery;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.BatchResponse;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.SendResponse;
import com.rbac.im.push.candidate.PushCandidate;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Lazy;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.annotation.EnableKafkaRetryTopic;
import org.springframework.kafka.annotation.RetryableTopic;
import org.springframework.kafka.retrytopic.DltStrategy;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.retry.annotation.Backoff;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.lang.reflect.Method;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;
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
        assertThat(retry.dltStrategy()).isEqualTo(DltStrategy.FAIL_ON_ERROR);
        assertThat(backoff.delay()).isEqualTo(1000L);
        assertThat(backoff.multiplier()).isEqualTo(2.0);
        assertThat(backoff.maxDelay()).isEqualTo(30000L);
        assertThat(backoff.random()).isTrue();
        assertThat(listener.groupId()).isEqualTo("im-push-delivery");
        assertThat(FirebaseAdminConfig.class).hasAnnotation(EnableKafkaRetryTopic.class);
    }

    @Test
    void dltHandlerBindsTheRetryTopicExceptionHeader() throws Exception {
        Method handler = PushCandidateConsumer.class.getMethod("handleDlt", String.class, byte[].class);
        Header header = handler.getParameters()[1].getAnnotation(Header.class);

        assertThat(header).isNotNull();
        assertThat(header.name()).isEqualTo(KafkaHeaders.EXCEPTION_MESSAGE);
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
    void dltHandlerIsTotalForTombstonesAndUnexpectedMapperFailures() throws Exception {
        ObjectMapper failingMapper = mock(ObjectMapper.class);
        when(failingMapper.readValue(anyString(), eq(PushCandidate.class)))
                .thenThrow(new IllegalStateException("secret payload fragment"));
        PushCandidateConsumer failingConsumer = new PushCandidateConsumer(
                failingMapper, delivery, new PushMetrics(registry));

        assertThatCode(() -> consumer.handleDlt(null, null)).doesNotThrowAnyException();
        assertThatCode(() -> failingConsumer.handleDlt("opaque", "INTERNAL".getBytes(StandardCharsets.UTF_8)))
                .doesNotThrowAnyException();
        assertThat(registry.get("im.push.dlt").tag("reason", "UNKNOWN").counter().count()).isEqualTo(1);
        assertThat(registry.get("im.push.dlt").tag("reason", "INTERNAL").counter().count()).isEqualTo(1);
    }

    @Test
    void dltLogsOnlyNormalizedMsgIdAndReason() {
        ch.qos.logback.classic.Logger logger = (ch.qos.logback.classic.Logger)
                org.slf4j.LoggerFactory.getLogger(PushCandidateConsumer.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            consumer.onDlt("secret\nforged-log", "provider detail INTERNAL secret");

            assertThat(appender.list).singleElement()
                    .extracting(ILoggingEvent::getFormattedMessage)
                    .isEqualTo("推送投递进入死信 msgId=UNKNOWN reason=UNKNOWN");
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void malformedCandidateEscapesAsJsonFailureWithoutCallingDelivery() {
        assertThatThrownBy(() -> consumer.onMessage("not-json secret payload"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid push candidate")
                .hasNoCause();
        verify(delivery, org.mockito.Mockito.never()).deliver(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void invalidCandidateAndUnexpectedMapperFailureEscapeWithoutPayloadOrCause() throws Exception {
        PushCandidate invalid = new PushCandidate(
                1, "secret\nforged-log", "g_100", 86L, 10L, "TEXT", "安全预览", List.of(), 123L);
        assertThatThrownBy(() -> consumer.onMessage(mapper.writeValueAsString(invalid)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid push candidate")
                .hasNoCause();

        ObjectMapper failingMapper = mock(ObjectMapper.class);
        when(failingMapper.readValue(anyString(), eq(PushCandidate.class)))
                .thenThrow(new IllegalStateException("secret payload fragment"));
        PushCandidateConsumer failingConsumer = new PushCandidateConsumer(
                failingMapper, delivery, new PushMetrics(registry));
        assertThatThrownBy(() -> failingConsumer.onMessage("secret raw body"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid push candidate")
                .hasNoCause();
    }

    @Test
    void structurallyInvalidCandidateEscapesAsTheSameSafeException() throws Exception {
        PushCandidate invalid = new PushCandidate(
                1, "msg-1", null, 86L, 10L, "TEXT", "安全预览", List.of(), 123L);

        assertThatThrownBy(() -> consumer.onMessage(mapper.writeValueAsString(invalid)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid push candidate")
                .hasNoCause();
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
    void enabledPushStartsWithoutAdcAndFirstSendFailsTransientlyWithoutLeakingCause() {
        try (org.mockito.MockedStatic<GoogleCredentials> credentials = mockStatic(GoogleCredentials.class)) {
            credentials.when(GoogleCredentials::getApplicationDefault)
                    .thenThrow(new IOException("sensitive credential path"));

            new ApplicationContextRunner()
                    .withPropertyValues(
                            "rbac.im.push.enabled=true",
                            "rbac.im.push.fresh-days=30",
                            "rbac.im.push.ttl-seconds=60")
                    .withBean(TaskScheduler.class, ThreadPoolTaskScheduler::new)
                    .withUserConfiguration(FirebaseAdminConfig.class, FirebaseAdminFcmGateway.class)
                    .run(context -> {
                        assertThat(context).hasNotFailed();
                        FcmGateway gateway = context.getBean(FcmGateway.class);

                        assertThat(gateway.send(List.of(
                                new FcmRequest("FID", "fid-1", "hash-1", Map.of("msgId", "msg-1")))))
                                .containsExactly(new FcmSendResult(
                                        false, PushFailureKind.TRANSIENT, "INTERNAL"));
                    });
        }
    }

    @Test
    void enabledPushStartsWhenNamedFirebaseInitializationFailsAtFirstSend() {
        GoogleCredentials adc = mock(GoogleCredentials.class);
        try (org.mockito.MockedStatic<GoogleCredentials> credentials = mockStatic(GoogleCredentials.class);
             org.mockito.MockedStatic<FirebaseApp> firebaseApps = mockStatic(FirebaseApp.class)) {
            credentials.when(GoogleCredentials::getApplicationDefault).thenReturn(adc);
            firebaseApps.when(() -> FirebaseApp.initializeApp(
                            any(FirebaseOptions.class), eq(FirebaseAdminConfig.FIREBASE_APP_NAME)))
                    .thenThrow(new IllegalStateException("sensitive initialization detail"));

            new ApplicationContextRunner()
                    .withPropertyValues(
                            "rbac.im.push.enabled=true",
                            "rbac.im.push.fresh-days=30",
                            "rbac.im.push.ttl-seconds=60")
                    .withBean(TaskScheduler.class, ThreadPoolTaskScheduler::new)
                    .withUserConfiguration(FirebaseAdminConfig.class, FirebaseAdminFcmGateway.class)
                    .run(context -> {
                        assertThat(context).hasNotFailed();
                        assertThat(context.getBean(FcmGateway.class).send(List.of(
                                new FcmRequest("FID", "fid-1", "hash-1", Map.of("msgId", "msg-1")))))
                                .containsExactly(new FcmSendResult(
                                        false, PushFailureKind.TRANSIENT, "INTERNAL"));
                    });
        }
    }

    @Test
    void firebaseUsesAnIsolatedLazyNamedAppWithExplicitDeleteLifecycle() throws Exception {
        Method factory = FirebaseAdminConfig.class.getDeclaredMethod("firebaseApp");
        Bean bean = factory.getAnnotation(Bean.class);

        assertThat(factory.isAnnotationPresent(Lazy.class)).isTrue();
        assertThat(bean.destroyMethod()).isEqualTo("delete");
        assertThat(FirebaseAdminConfig.FIREBASE_APP_NAME).isEqualTo("rbac-im-push");

        GoogleCredentials adc = mock(GoogleCredentials.class);
        FirebaseApp app = mock(FirebaseApp.class);
        try (org.mockito.MockedStatic<GoogleCredentials> credentials = mockStatic(GoogleCredentials.class);
             org.mockito.MockedStatic<FirebaseApp> firebaseApps = mockStatic(FirebaseApp.class)) {
            credentials.when(GoogleCredentials::getApplicationDefault).thenReturn(adc);
            firebaseApps.when(() -> FirebaseApp.initializeApp(
                            any(FirebaseOptions.class), eq(FirebaseAdminConfig.FIREBASE_APP_NAME)))
                    .thenReturn(app);

            assertThat(new FirebaseAdminConfig().firebaseApp()).isSameAs(app);
            firebaseApps.verify(() -> FirebaseApp.initializeApp(
                    any(FirebaseOptions.class), eq(FirebaseAdminConfig.FIREBASE_APP_NAME)));
        }
    }

    @Test
    void initializedNamedFirebaseAppIsDeletedWhenContextCloses() throws Exception {
        GoogleCredentials adc = mock(GoogleCredentials.class);
        FirebaseApp app = mock(FirebaseApp.class);
        FirebaseMessaging messaging = mock(FirebaseMessaging.class);
        BatchResponse batch = mock(BatchResponse.class);
        SendResponse response = mock(SendResponse.class);
        when(response.isSuccessful()).thenReturn(true);
        when(batch.getResponses()).thenReturn(List.of(response));
        when(messaging.sendEach(org.mockito.ArgumentMatchers.anyList())).thenReturn(batch);

        try (org.mockito.MockedStatic<GoogleCredentials> credentials = mockStatic(GoogleCredentials.class);
             org.mockito.MockedStatic<FirebaseApp> firebaseApps = mockStatic(FirebaseApp.class);
             org.mockito.MockedStatic<FirebaseMessaging> messagingFactory = mockStatic(FirebaseMessaging.class)) {
            credentials.when(GoogleCredentials::getApplicationDefault).thenReturn(adc);
            firebaseApps.when(() -> FirebaseApp.initializeApp(
                            any(FirebaseOptions.class), eq(FirebaseAdminConfig.FIREBASE_APP_NAME)))
                    .thenReturn(app);
            messagingFactory.when(() -> FirebaseMessaging.getInstance(app)).thenReturn(messaging);

            new ApplicationContextRunner()
                    .withPropertyValues(
                            "rbac.im.push.enabled=true",
                            "rbac.im.push.fresh-days=30",
                            "rbac.im.push.ttl-seconds=60")
                    .withBean(TaskScheduler.class, ThreadPoolTaskScheduler::new)
                    .withUserConfiguration(FirebaseAdminConfig.class, FirebaseAdminFcmGateway.class)
                    .run(context -> {
                        assertThat(context).hasNotFailed();
                        assertThat(context.getBean(FcmGateway.class).send(List.of(
                                new FcmRequest("FID", "fid-1", "hash-1", Map.of("msgId", "msg-1")))))
                                .containsExactly(FcmSendResult.delivered());
                    });

            verify(app).delete();
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
