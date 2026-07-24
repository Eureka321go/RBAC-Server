package com.rbac.im.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;

/** 链接卡片抓取配置。所有阈值可经 rbac.im.link.* 调整。 */
@Component
@ConfigurationProperties(prefix = "rbac.im.link")
@Data
public class LinkPreviewProperties {
    /** 总开关，false 则完全不抓取。 */
    private boolean enabled = true;
    private int connectTimeoutMs = 2000;
    private int requestTimeoutMs = 2000;
    private long maxBodyBytes = 524288;      // 512KB
    private int maxRedirects = 3;
    private List<Integer> allowedPorts = List.of(80, 443);
    private String userAgent = "RBAC-IM-LinkBot/1.0";
    private Duration cacheTtlOk = Duration.ofHours(6);
    private Duration cacheTtlFail = Duration.ofMinutes(10);
    private int poolCore = 2;
    private int poolMax = 4;
    private int poolQueue = 100;
}
