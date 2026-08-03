package com.rbac.im.push.registration;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class PushRegistrationServiceTest {

    private static final String FID_A_HASH = "ef6c2b2e3871de0eb68704908cc63d7a17e323a18d7bb692369f8f8d5b450e52";

    private final ImPushRegistrationMapper mapper = mock(ImPushRegistrationMapper.class);
    private final Clock clock = Clock.fixed(Instant.parse("2026-07-30T08:15:30Z"), ZoneOffset.UTC);
    private PushRegistrationService service;

    @BeforeEach
    void setUp() {
        service = new PushRegistrationService(mapper, clock);
    }

    @Test
    void upsert_insertsEnabledRegistrationWithHashedTarget() {
        when(mapper.selectByUserDevice(20L, "device-a", "FCM")).thenReturn(null);
        when(mapper.selectByTargetHash("FCM", FID_A_HASH))
                .thenReturn(null);

        service.upsert(20L, "device-a", request("fid-a"));

        ArgumentCaptor<ImPushRegistration> captured = ArgumentCaptor.forClass(ImPushRegistration.class);
        verify(mapper).insert(captured.capture());
        ImPushRegistration saved = captured.getValue();
        assertThat(saved.getUserId()).isEqualTo(20L);
        assertThat(saved.getDeviceId()).isEqualTo("device-a");
        assertThat(saved.getPlatform()).isEqualTo("ANDROID");
        assertThat(saved.getProvider()).isEqualTo("FCM");
        assertThat(saved.getTargetType()).isEqualTo("FID");
        assertThat(saved.getTargetHash()).isEqualTo(FID_A_HASH);
        assertThat(saved.getEnabled()).isEqualTo(1);
        assertThat(saved.getLastSeenAt()).isEqualTo(LocalDateTime.of(2026, 7, 30, 8, 15, 30));
    }

    @Test
    void upsert_rebindsExistingTargetToAuthenticatedAccount() {
        ImPushRegistration target = registration(10L, "old-device", "hash-a");
        when(mapper.selectByTargetHash("FCM", FID_A_HASH)).thenReturn(target);
        when(mapper.selectByUserDevice(20L, "new-device", "FCM")).thenReturn(null);

        service.upsert(20L, "new-device", request("fid-a"));

        assertThat(target.getUserId()).isEqualTo(20L);
        assertThat(target.getDeviceId()).isEqualTo("new-device");
        assertThat(target.getEnabled()).isEqualTo(1);
        verify(mapper).updateById(target);
    }

    @Test
    void upsert_removesCurrentDeviceRowBeforeRebindingDifferentTargetRow() {
        ImPushRegistration byDevice = registration(20L, "device-a", "hash-old");
        byDevice.setId(3L);
        ImPushRegistration byTarget = registration(10L, "old-device", "hash-a");
        byTarget.setId(4L);
        when(mapper.selectByUserDevice(20L, "device-a", "FCM")).thenReturn(byDevice);
        when(mapper.selectByTargetHash("FCM", FID_A_HASH)).thenReturn(byTarget);

        service.upsert(20L, "device-a", request("fid-a"));

        verify(mapper).physicalDeleteById(3L);
        verify(mapper).updateById(byTarget);
        verify(mapper, never()).updateById(byDevice);
    }

    @Test
    void upsert_refreshesExistingUsersDevice() {
        ImPushRegistration existing = registration(20L, "device-a", "hash-a");
        when(mapper.selectByUserDevice(20L, "device-a", "FCM")).thenReturn(existing);
        when(mapper.selectByTargetHash("FCM", FID_A_HASH)).thenReturn(null);

        service.upsert(20L, "device-a", request("fid-a"));

        assertThat(existing.getEnabled()).isEqualTo(1);
        assertThat(existing.getLastSeenAt()).isEqualTo(LocalDateTime.of(2026, 7, 30, 8, 15, 30));
        verify(mapper).updateById(existing);
    }

    @Test
    void disable_onlyTouchesAuthenticatedUsersDevice() {
        service.disable(20L, "device-a");

        verify(mapper).disableByUserDevice(20L, "device-a", "FCM");
    }

    @Test
    void disableTargetHash_delegatesToFcmRegistration() {
        service.disableTargetHash("hash-a");

        verify(mapper).disableByTargetHash("FCM", "hash-a");
    }

    @Test
    void findFreshEnabledByUserIds_delegatesFilteringToMapper() {
        LocalDateTime freshAfter = LocalDateTime.of(2026, 7, 29, 0, 0);
        ImPushRegistration expected = registration(20L, "device-a", "hash-a");
        when(mapper.selectFreshEnabled(List.of(20L, 21L), freshAfter)).thenReturn(List.of(expected));

        List<ImPushRegistration> registrations = service.findFreshEnabledByUserIds(List.of(20L, 21L), freshAfter);

        assertThat(registrations).containsExactly(expected);
        verify(mapper).selectFreshEnabled(List.of(20L, 21L), freshAfter);
    }

    @Test
    void findFreshEnabledByUserIds_returnsEmptyWithoutQueryingMapperWhenUserIdsAreEmpty() {
        List<ImPushRegistration> registrations = service.findFreshEnabledByUserIds(List.of(), LocalDateTime.now(clock));

        assertThat(registrations).isEmpty();
        verifyNoInteractions(mapper);
    }

    private PushRegistrationRequest request(String targetValue) {
        return new PushRegistrationRequest("ANDROID", "FCM", "FID", targetValue, "1.0");
    }

    private ImPushRegistration registration(long userId, String deviceId, String targetHash) {
        ImPushRegistration registration = new ImPushRegistration();
        registration.setId(1L);
        registration.setUserId(userId);
        registration.setDeviceId(deviceId);
        registration.setTargetHash(targetHash);
        registration.setEnabled(0);
        return registration;
    }
}
