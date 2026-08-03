package com.rbac.im.push.delivery;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.rbac.im.push.candidate.PushCandidate;
import com.rbac.im.push.registration.ImPushRegistration;
import com.rbac.im.push.registration.PushRegistrationService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PushLogRedactionTest {

    private Logger logger;
    private ListAppender<ILoggingEvent> appender;

    @AfterEach
    void detachAppender() {
        if (logger != null && appender != null) {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void transientFailureLogsOnlyMessageIdAndCoarseReason() {
        PushRecipientResolver resolver = mock(PushRecipientResolver.class);
        PushPresentationService presentations = mock(PushPresentationService.class);
        FcmPayloadFactory payloadFactory = mock(FcmPayloadFactory.class);
        FcmGateway gateway = mock(FcmGateway.class);
        PushRegistrationService registrations = mock(PushRegistrationService.class);
        PushDeliveryService service = new PushDeliveryService(
                resolver,
                presentations,
                payloadFactory,
                gateway,
                registrations,
                new PushMetrics(new SimpleMeterRegistry()));
        PushCandidate candidate = new PushCandidate(
                1, "msg-1", "g_100", 86L, 10L, "TEXT", "私密消息", List.of(), 123L);
        ImPushRegistration registration = new ImPushRegistration();
        registration.setTargetType("FID");
        registration.setTargetValue("sensitive-target");
        registration.setTargetHash("sensitive-target-hash");
        when(resolver.resolve(candidate)).thenReturn(List.of(new PushTarget(registration, 20L, false)));
        when(presentations.resolve(candidate)).thenReturn(new PushPresentation("私密会话", "私密发送人"));
        when(payloadFactory.create(any(), any(), any())).thenReturn(Map.of(
                "msgId", candidate.msgId(),
                "preview", candidate.preview()));
        when(gateway.send(anyList())).thenReturn(List.of(
                new FcmSendResult(false, PushFailureKind.TRANSIENT, "UNAVAILABLE")));
        attachListAppender();

        Throwable failure = catchThrowable(() -> service.deliver(candidate));

        String logs = appender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .collect(Collectors.joining("\n"));
        assertThat(failure).isInstanceOf(TransientPushException.class);
        assertThat(logs)
                .contains("msg-1", "UNAVAILABLE")
                .doesNotContain("sensitive-target", "sensitive-target-hash", "私密消息", "私密会话", "私密发送人");
    }

    private void attachListAppender() {
        LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
        logger = context.getLogger(PushDeliveryService.class);
        appender = new ListAppender<>();
        appender.setContext(context);
        appender.start();
        logger.addAppender(appender);
    }
}
