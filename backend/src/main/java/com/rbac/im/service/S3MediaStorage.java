package com.rbac.im.service;

import com.rbac.im.config.MediaProperties;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.net.URI;
import java.time.Duration;
import java.util.Optional;

/** {@link MediaStorage} 的 AWS SDK v2 实现；endpoint override 使其对 MinIO/阿里云 OSS 通用。 */
@Component
public class S3MediaStorage implements MediaStorage {

    private static final Logger log = LoggerFactory.getLogger(S3MediaStorage.class);

    private final MediaProperties props;
    private final S3Client s3;
    private final S3Presigner presigner;

    public S3MediaStorage(MediaProperties props) {
        this.props = props;
        StaticCredentialsProvider creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(props.getAccessKey(), props.getSecretKey()));
        Region region = Region.of(props.getRegion());
        URI endpoint = URI.create(props.getEndpoint());
        this.s3 = S3Client.builder()
                .endpointOverride(endpoint)
                .credentialsProvider(creds)
                .region(region)
                .forcePathStyle(true)   // MinIO 需 path-style 寻址
                .build();
        this.presigner = S3Presigner.builder()
                .endpointOverride(endpoint)
                .credentialsProvider(creds)
                .region(region)
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .build();
    }

    /** 启动时尝试建桶；失败只告警不阻断启动（MinIO 恢复前媒体不可用）。 */
    @PostConstruct
    void init() {
        try {
            ensureBucket();
        } catch (Exception e) {
            log.warn("MinIO ensureBucket 失败，媒体上传在 MinIO 恢复前不可用: {}", e.toString());
        }
    }

    @Override
    public void ensureBucket() {
        try {
            s3.headBucket(b -> b.bucket(props.getBucket()));
        } catch (NoSuchBucketException e) {
            s3.createBucket(b -> b.bucket(props.getBucket()));
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                s3.createBucket(b -> b.bucket(props.getBucket()));
            } else {
                throw e;
            }
        }
    }

    @Override
    public String presignPut(String objectKey, long contentLength, String contentType, Duration ttl) {
        PutObjectRequest put = PutObjectRequest.builder()
                .bucket(props.getBucket()).key(objectKey)
                .contentLength(contentLength)   // 入签名 → 改字节数即签名失配
                .contentType(contentType)       // 入签名 → 改 mime 即签名失配
                .build();
        return presigner.presignPutObject(b -> b.signatureDuration(ttl).putObjectRequest(put))
                .url().toString();
    }

    @Override
    public String presignGet(String objectKey, Duration ttl) {
        GetObjectRequest get = GetObjectRequest.builder()
                .bucket(props.getBucket()).key(objectKey).build();
        return presigner.presignGetObject(b -> b.signatureDuration(ttl).getObjectRequest(get))
                .url().toString();
    }

    @Override
    public Optional<ObjectStat> stat(String objectKey) {
        try {
            HeadObjectResponse head = s3.headObject(b -> b.bucket(props.getBucket()).key(objectKey));
            return Optional.of(new ObjectStat(head.contentLength(), head.contentType()));
        } catch (NoSuchKeyException e) {
            return Optional.empty();
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                return Optional.empty();
            }
            throw e;
        }
    }

    /** 释放 SDK 的 HTTP 客户端与连接池（否则每个测试上下文都会泄漏一份）。 */
    @PreDestroy
    void close() {
        s3.close();
        presigner.close();
    }
}
