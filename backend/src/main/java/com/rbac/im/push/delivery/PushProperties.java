package com.rbac.im.push.delivery;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("rbac.im.push")
public record PushProperties(boolean enabled, int freshDays, long ttlSeconds) {

    public PushProperties {
        if (freshDays < 1) {
            throw new IllegalArgumentException("freshDays must be positive");
        }
        if (ttlSeconds < 1) {
            throw new IllegalArgumentException("ttlSeconds must be positive");
        }
    }
}
