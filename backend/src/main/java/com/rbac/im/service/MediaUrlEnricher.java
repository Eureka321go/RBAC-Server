package com.rbac.im.service;

import com.rbac.im.config.MediaProperties;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** 给富媒体消息 body 附加临时预签名 GET url。push 与 pull 两条读路径共用，保证在线/离线回显一致。 */
@Service
public class MediaUrlEnricher {

    static final Set<String> MEDIA_TYPES = Set.of("IMAGE", "AUDIO", "FILE");

    private final MediaStorage storage;
    private final MediaProperties props;

    public MediaUrlEnricher(MediaStorage storage, MediaProperties props) {
        this.storage = storage;
        this.props = props;
    }

    /** 媒体类型且含 objectKey → 返回带 url 的新副本；否则原样返回（不改动持久化 body）。 */
    public Map<String, Object> enrich(String type, Map<String, Object> body) {
        if (!MEDIA_TYPES.contains(type) || body == null || !(body.get("objectKey") instanceof String objectKey)) {
            return body;
        }
        Map<String, Object> copy = new HashMap<>(body);
        copy.put("url", storage.presignGet(objectKey, Duration.ofSeconds(props.getGetTtlSeconds())));
        return copy;
    }
}
