package com.rbac.im.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class SeqService {

    private static final String SEQ_KEY = "im:conv:%s:seq";

    private final StringRedisTemplate redis;

    public SeqService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** 会话内单调递增序号；Redis INCR 保证并发下唯一有序。 */
    public long nextSeq(String cid) {
        Long v = redis.opsForValue().increment(SEQ_KEY.formatted(cid));
        return v == null ? 0L : v;
    }
}
