package com.rbac.im.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** 富媒体对象存储配置（S3 兼容：MinIO/OSS）。 */
@Component
@ConfigurationProperties(prefix = "rbac.im.media")
@Data
public class MediaProperties {

    private String endpoint;
    private String accessKey;
    private String secretKey;
    private String bucket;
    private String region = "us-east-1";
    private long putTtlSeconds = 300;
    private long getTtlSeconds = 300;
    private long multipartThreshold = 5L * 1024 * 1024;
    private long multipartPartSize = 5L * 1024 * 1024;
    private long multipartSessionTtlSeconds = 86400;
    private long cleanupDelayMs = 300000;
    /** key = 小写类型（image/audio/file）。 */
    private Map<String, Limit> limits = new HashMap<>();

    /** 按消息类型取上限规则；未知类型返回 null。 */
    public Limit limitFor(String type) {
        return type == null ? null : limits.get(type.toLowerCase(Locale.ROOT));
    }

    @Data
    public static class Limit {
        private long maxSize;
        private List<String> mimes = new ArrayList<>();
    }
}
