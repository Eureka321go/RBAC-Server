package com.rbac.im.service;

import java.time.Duration;
import java.util.Optional;

/** 对象存储端口（S3 兼容）。唯一接触 S3 SDK 的抽象，便于逻辑层单测 mock。 */
public interface MediaStorage {

    /** 桶不存在则创建（幂等）。 */
    void ensureBucket();

    /** 生成预签名 PUT URL（客户端直传用）。 */
    String presignPut(String objectKey, Duration ttl);

    /** 生成预签名 GET URL（客户端回显用，短 TTL）。 */
    String presignGet(String objectKey, Duration ttl);

    /** HEAD 对象；不存在返回 empty。 */
    Optional<ObjectStat> stat(String objectKey);

    /** 对象元数据（服务端权威）。 */
    record ObjectStat(long size, String contentType) {}
}
