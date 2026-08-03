package com.rbac.im.push.delivery;

import java.util.Map;

public record FcmRequest(
        String targetType,
        String targetValue,
        String targetHash,
        Map<String, String> data) {
}
