package com.rbac.im.push.registration;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record PushRegistrationRequest(
        @NotBlank @Pattern(regexp = "ANDROID") String platform,
        @NotBlank @Pattern(regexp = "FCM") String provider,
        @NotBlank @Pattern(regexp = "FID|TOKEN") String targetType,
        @NotBlank @Size(max = 2048) String targetValue,
        @Size(max = 32) String appVersion) {
}
