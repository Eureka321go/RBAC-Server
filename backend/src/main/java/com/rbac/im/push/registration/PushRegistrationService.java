package com.rbac.im.push.registration;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HexFormat;
import java.util.List;

@Service
public class PushRegistrationService {

    private static final String FCM = "FCM";

    private final ImPushRegistrationMapper mapper;
    private final Clock clock;

    public PushRegistrationService(ImPushRegistrationMapper mapper) {
        this(mapper, Clock.systemDefaultZone());
    }

    PushRegistrationService(ImPushRegistrationMapper mapper, Clock clock) {
        this.mapper = mapper;
        this.clock = clock;
    }

    @Transactional
    public void upsert(long userId, String deviceId, PushRegistrationRequest request) {
        String targetHash = sha256(request.targetValue());
        ImPushRegistration byDevice = mapper.selectByUserDevice(userId, deviceId, FCM);
        ImPushRegistration byTarget = mapper.selectByTargetHash(FCM, targetHash);
        if (byDevice != null && byTarget != null && !byDevice.getId().equals(byTarget.getId())) {
            mapper.physicalDeleteById(byDevice.getId());
        }

        ImPushRegistration row = byTarget != null ? byTarget : byDevice;
        boolean insert = row == null;
        if (insert) {
            row = new ImPushRegistration();
        }
        row.setUserId(userId);
        row.setDeviceId(deviceId);
        row.setPlatform(request.platform());
        row.setProvider(request.provider());
        row.setTargetType(request.targetType());
        row.setTargetValue(request.targetValue());
        row.setTargetHash(targetHash);
        row.setAppVersion(request.appVersion());
        row.setEnabled(1);
        row.setLastSeenAt(LocalDateTime.now(clock));
        if (insert) {
            mapper.insert(row);
        } else {
            mapper.updateById(row);
        }
    }

    public void disable(long userId, String deviceId) {
        mapper.disableByUserDevice(userId, deviceId, FCM);
    }

    public void disableTargetHash(String targetHash) {
        mapper.disableByTargetHash(FCM, targetHash);
    }

    public List<ImPushRegistration> findFreshEnabledByUserIds(Collection<Long> userIds, LocalDateTime freshAfter) {
        return mapper.selectFreshEnabled(userIds, freshAfter);
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
