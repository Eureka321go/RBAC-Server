package com.rbac.im.push.candidate;

import org.springframework.stereotype.Component;

import java.util.Map;

@Component
public class PushPreviewFactory {

    private static final int MAX_CODE_POINTS = 120;
    private static final Map<String, String> MEDIA_LABELS = Map.of(
            "IMAGE", "[图片]",
            "AUDIO", "[语音]",
            "FILE", "[文件]");

    public String create(String type, Map<String, Object> body) {
        if (!"TEXT".equals(type)) {
            return MEDIA_LABELS.get(type);
        }
        String normalized = String.valueOf(body.getOrDefault("text", ""))
                .replaceAll("\\s+", " ").trim();
        int end = normalized.offsetByCodePoints(
                0, Math.min(MAX_CODE_POINTS, normalized.codePointCount(0, normalized.length())));
        return normalized.substring(0, end);
    }
}
