package com.rbac.im.service;

import java.time.Duration;
import java.util.List;
import java.util.Optional;

/** 对象存储端口（S3 兼容）。唯一接触 S3 SDK 的抽象，便于逻辑层单测 mock。 */
public interface MediaStorage {

    /** 桶不存在则创建（幂等）。 */
    void ensureBucket();

    /**
     * 生成预签名 PUT URL（客户端直传用）。
     * <p>申报的 {@code contentLength} / {@code contentType} 必须参与签名，
     * 使客户端无法用同一 URL 上传超限字节数或白名单外的 Content-Type
     * （未签名的头 SigV4 不做约束，等于放开大小/mime 上限）。
     */
    String presignPut(String objectKey, long contentLength, String contentType, Duration ttl);

    /** 生成预签名 GET URL（客户端回显用，短 TTL）。 */
    String presignGet(String objectKey, Duration ttl);

    /** 创建分片上传会话。 */
    MultipartSession createMultipart(String objectKey, String contentType);

    /** 为一个确定大小的分片签发直传地址。 */
    String presignUploadPart(String objectKey, String uploadId, int partNumber,
                             long contentLength, Duration ttl);

    /** 查询对象存储中已成功落下的分片，作为断点恢复的权威状态。 */
    List<UploadedPart> listParts(String objectKey, String uploadId);

    /** 按权威分片列表完成对象。 */
    void completeMultipart(String objectKey, String uploadId, List<UploadedPart> parts);

    /** 取消会话并释放对象存储中的临时分片。 */
    void abortMultipart(String objectKey, String uploadId);

    /** HEAD 对象；不存在返回 empty。 */
    Optional<ObjectStat> stat(String objectKey);

    /** 对象元数据（服务端权威）。 */
    record ObjectStat(long size, String contentType) {}

    record MultipartSession(String uploadId) {}

    record UploadedPart(int partNumber, String eTag, long size) {}
}
