package com.rbac.im.push.delivery;

import com.google.firebase.messaging.AndroidConfig;
import com.google.firebase.messaging.BatchResponse;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.MessagingErrorCode;
import com.google.firebase.messaging.SendResponse;
import com.rbac.im.push.candidate.PushCandidate;
import com.rbac.im.push.registration.ImPushRegistration;
import com.rbac.im.push.registration.PushRegistrationService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class PushDeliveryServiceTest {

    private final PushRecipientResolver resolver = mock(PushRecipientResolver.class);
    private final PushPresentationService presentations = mock(PushPresentationService.class);
    private final FcmPayloadFactory payloadFactory = mock(FcmPayloadFactory.class);
    private final FcmGateway gateway = mock(FcmGateway.class);
    private final PushRegistrationService registrations = mock(PushRegistrationService.class);
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private PushDeliveryService service;

    @BeforeEach
    void setUp() {
        service = new PushDeliveryService(
                resolver, presentations, payloadFactory, gateway, registrations, new PushMetrics(registry));
    }

    @Test
    void deliver_batchesBy500_disablesPermanentTargets_andRetriesTransientOnes() {
        PushCandidate candidate = candidate();
        List<PushTarget> targets = targets(501);
        when(resolver.resolve(candidate)).thenReturn(targets);
        when(presentations.resolve(candidate)).thenReturn(new PushPresentation("研发群", "张三"));
        when(payloadFactory.create(any(), any(), any())).thenReturn(Map.of("msgId", candidate.msgId()));
        when(gateway.send(anyList()))
                .thenReturn(results(500, 3, PushFailureKind.PERMANENT, "UNREGISTERED"))
                .thenReturn(results(1, 0, PushFailureKind.TRANSIENT, "UNAVAILABLE"));

        assertThatThrownBy(() -> service.deliver(candidate))
                .isInstanceOf(TransientPushException.class)
                .hasMessage("UNAVAILABLE");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<FcmRequest>> batches = ArgumentCaptor.forClass(List.class);
        verify(gateway, times(2)).send(batches.capture());
        assertThat(batches.getAllValues()).extracting(List::size).containsExactly(500, 1);
        assertThat(batches.getAllValues().getFirst()).allMatch(request -> request.targetType().equals("FID"));
        verify(registrations).disableTargetHash("hash-3");
        assertThat(registry.get("im.push.delivery").tag("result", "permanent_failure")
                .tag("reason", "UNREGISTERED").counter().count()).isEqualTo(1);
        assertThat(registry.get("im.push.delivery").tag("result", "transient_failure")
                .tag("reason", "UNAVAILABLE").counter().count()).isEqualTo(1);
    }

    @Test
    void deliver_successRecordsCandidatesTargetsDeliveriesAndLatency() {
        PushCandidate candidate = candidate();
        when(resolver.resolve(candidate)).thenReturn(targets(2));
        when(presentations.resolve(candidate)).thenReturn(new PushPresentation("研发群", "张三"));
        when(payloadFactory.create(any(), any(), any())).thenReturn(Map.of("msgId", candidate.msgId()));
        when(gateway.send(anyList())).thenReturn(results(2, -1, PushFailureKind.NONE, "NONE"));

        service.deliver(candidate);

        assertThat(registry.get("im.push.candidates").tag("result", "accepted").counter().count()).isEqualTo(1);
        assertThat(registry.get("im.push.targets").tag("result", "resolved").counter().count()).isEqualTo(2);
        assertThat(registry.get("im.push.delivery").tag("result", "success")
                .tag("reason", "NONE").counter().count()).isEqualTo(2);
        assertThat(registry.get("im.push.latency").tag("stage", "delivery").timer().count()).isEqualTo(1);
        verify(registrations, never()).disableTargetHash(any());
    }

    @Test
    void deliver_withNoTargetsDoesNotResolvePresentationOrCallGateway() {
        PushCandidate candidate = candidate();
        when(resolver.resolve(candidate)).thenReturn(List.of());

        service.deliver(candidate);

        verify(presentations, never()).resolve(any());
        verify(gateway, never()).send(anyList());
        assertThat(registry.get("im.push.targets").tag("result", "resolved").counter().count()).isZero();
    }

    @Test
    void deliver_treatsMismatchedGatewayResponseAsTransientFailure() {
        PushCandidate candidate = candidate();
        when(resolver.resolve(candidate)).thenReturn(targets(2));
        when(presentations.resolve(candidate)).thenReturn(new PushPresentation("研发群", "张三"));
        when(payloadFactory.create(any(), any(), any())).thenReturn(Map.of("msgId", candidate.msgId()));
        when(gateway.send(anyList())).thenReturn(List.of(FcmSendResult.delivered()));

        assertThatThrownBy(() -> service.deliver(candidate))
                .isInstanceOf(TransientPushException.class)
                .hasMessage("INTERNAL");
        verify(registrations, never()).disableTargetHash(any());
    }

    @Test
    void firebaseGateway_usesFidAndToken_highPriority_millisecondTtl_andClassifiesResponses() throws Exception {
        FirebaseMessaging messaging = mock(FirebaseMessaging.class);
        BatchResponse batchResponse = mock(BatchResponse.class);
        SendResponse delivered = sendResponse(true, null);
        SendResponse unregistered = sendResponse(false, MessagingErrorCode.UNREGISTERED);
        SendResponse unavailable = sendResponse(false, MessagingErrorCode.UNAVAILABLE);
        when(batchResponse.getResponses()).thenReturn(List.of(delivered, unregistered, unavailable));
        when(messaging.sendEach(anyList())).thenReturn(batchResponse);
        FirebaseAdminFcmGateway firebaseGateway = new FirebaseAdminFcmGateway(
                messaging, new PushProperties(true, 30, 86400));
        List<FcmRequest> requests = List.of(
                request("FID", "fid-value"), request("TOKEN", "token-value"), request("FID", "fid-2"));

        List<FcmSendResult> results = firebaseGateway.send(requests);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Message>> messages = ArgumentCaptor.forClass(List.class);
        verify(messaging).sendEach(messages.capture());
        assertThat(ReflectionTestUtils.getField(messages.getValue().get(0), "fid")).isEqualTo("fid-value");
        assertThat(ReflectionTestUtils.getField(messages.getValue().get(0), "token")).isNull();
        assertThat(ReflectionTestUtils.getField(messages.getValue().get(1), "token")).isEqualTo("token-value");
        assertThat(ReflectionTestUtils.getField(messages.getValue().get(1), "fid")).isNull();
        AndroidConfig android = (AndroidConfig) ReflectionTestUtils.getField(messages.getValue().get(0), "androidConfig");
        assertThat(ReflectionTestUtils.getField(android, "priority")).isEqualTo("high");
        assertThat(ReflectionTestUtils.getField(android, "ttl")).isEqualTo("86400s");
        assertThat(ReflectionTestUtils.getField(android, "data")).isEqualTo(Map.of("msgId", "msg-1"));
        assertThat(results).containsExactly(
                FcmSendResult.delivered(),
                new FcmSendResult(false, PushFailureKind.PERMANENT, "UNREGISTERED"),
                new FcmSendResult(false, PushFailureKind.TRANSIENT, "UNAVAILABLE"));
    }

    @Test
    void firebaseGateway_mapsBatchQuotaFailureToTransientResultsWithoutLeakingSdkMessage() throws Exception {
        FirebaseMessaging messaging = mock(FirebaseMessaging.class);
        FirebaseMessagingException exception = mock(FirebaseMessagingException.class);
        when(exception.getMessagingErrorCode()).thenReturn(MessagingErrorCode.QUOTA_EXCEEDED);
        when(messaging.sendEach(anyList())).thenThrow(exception);
        FirebaseAdminFcmGateway firebaseGateway = new FirebaseAdminFcmGateway(
                messaging, new PushProperties(true, 30, 60));

        assertThat(firebaseGateway.send(List.of(request("FID", "fid-1"), request("FID", "fid-2"))))
                .containsExactly(
                        new FcmSendResult(false, PushFailureKind.TRANSIENT, "QUOTA_EXCEEDED"),
                        new FcmSendResult(false, PushFailureKind.TRANSIENT, "QUOTA_EXCEEDED"));
    }

    @Test
    void firebaseGateway_rejectsOversizedBatchBeforeCallingFirebase() {
        FirebaseMessaging messaging = mock(FirebaseMessaging.class);
        FirebaseAdminFcmGateway firebaseGateway = new FirebaseAdminFcmGateway(
                messaging, new PushProperties(true, 30, 60));
        List<FcmRequest> oversized = new ArrayList<>();
        for (int index = 0; index < 501; index++) {
            oversized.add(request("FID", "fid-" + index));
        }

        assertThatThrownBy(() -> firebaseGateway.send(oversized))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("FCM batch exceeds 500 messages");
        verifyNoInteractions(messaging);
    }

    @Test
    void firebaseGateway_rejectsUnknownTargetTypeBeforeCallingFirebase() {
        FirebaseMessaging messaging = mock(FirebaseMessaging.class);
        FirebaseAdminFcmGateway firebaseGateway = new FirebaseAdminFcmGateway(
                messaging, new PushProperties(true, 30, 60));

        assertThatThrownBy(() -> firebaseGateway.send(List.of(request("APNS", "target"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Unsupported FCM target type");
        verifyNoInteractions(messaging);
    }

    private PushCandidate candidate() {
        return new PushCandidate(1, "msg-1", "g_100", 86L, 10L, "TEXT", "安全预览", List.of(), 123L);
    }

    private List<PushTarget> targets(int count) {
        List<PushTarget> targets = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            ImPushRegistration registration = new ImPushRegistration();
            registration.setTargetType("FID");
            registration.setTargetValue("fid-" + i);
            registration.setTargetHash("hash-" + i);
            targets.add(new PushTarget(registration, 1000L + i, false));
        }
        return targets;
    }

    private List<FcmSendResult> results(int count, int failedIndex, PushFailureKind kind, String reason) {
        List<FcmSendResult> results = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            results.add(i == failedIndex ? new FcmSendResult(false, kind, reason) : FcmSendResult.delivered());
        }
        return results;
    }

    private FcmRequest request(String targetType, String targetValue) {
        return new FcmRequest(targetType, targetValue, "hash", Map.of("msgId", "msg-1"));
    }

    private SendResponse sendResponse(boolean success, MessagingErrorCode errorCode) {
        SendResponse response = mock(SendResponse.class);
        when(response.isSuccessful()).thenReturn(success);
        if (!success) {
            FirebaseMessagingException exception = mock(FirebaseMessagingException.class);
            when(exception.getMessagingErrorCode()).thenReturn(errorCode);
            when(response.getException()).thenReturn(exception);
        }
        return response;
    }
}
