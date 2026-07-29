package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.config.MediaProperties;
import com.rbac.im.entity.ImMediaUpload;
import com.rbac.im.mapper.ImMediaUploadMapper;
import com.rbac.im.vo.MultipartInitResult;
import com.rbac.im.vo.MultipartStatusResult;
import com.rbac.im.vo.UploadPartPresignResult;
import com.rbac.im.vo.UploadedPartResult;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/** S3 Multipart 上传会话编排；文件字节仍由客户端直传对象存储。 */
@Service
public class MultipartMediaService {

    static final String UPLOADING = "UPLOADING";
    static final String COMPLETED = "COMPLETED";
    static final String ABORTED = "ABORTED";
    static final String EXPIRED = "EXPIRED";

    private final MediaProperties props;
    private final MediaStorage storage;
    private final MediaService mediaService;
    private final ConversationService conversationService;
    private final ImMediaUploadMapper mapper;

    public MultipartMediaService(MediaProperties props,
                                 MediaStorage storage,
                                 MediaService mediaService,
                                 ConversationService conversationService,
                                 ImMediaUploadMapper mapper) {
        this.props = props;
        this.storage = storage;
        this.mediaService = mediaService;
        this.conversationService = conversationService;
        this.mapper = mapper;
    }

    public MultipartInitResult init(long userId, String cid, String type,
                                    String filename, String mime, long size) {
        mediaService.validateUploadRequest(userId, cid, type, mime, size);
        if (size < props.getMultipartThreshold()) {
            throw new BusinessException(400, "im.media.multipartTooSmall");
        }
        String objectKey = mediaService.buildObjectKey(cid, filename);
        MediaStorage.MultipartSession storageSession = storage.createMultipart(objectKey, mime);
        LocalDateTime now = LocalDateTime.now();
        ImMediaUpload row = new ImMediaUpload();
        row.setTaskId(UUID.randomUUID().toString());
        row.setOwnerId(userId);
        row.setCid(cid);
        row.setMessageType(type);
        row.setFilename(mediaService.safeFilename(filename));
        row.setMime(mime);
        row.setTotalSize(size);
        row.setPartSize(props.getMultipartPartSize());
        row.setObjectKey(objectKey);
        row.setUploadId(storageSession.uploadId());
        row.setStatus(UPLOADING);
        row.setExpiresAt(now.plusSeconds(props.getMultipartSessionTtlSeconds()));
        row.setCreatedAt(now);
        row.setUpdatedAt(now);
        try {
            mapper.insert(row);
        } catch (RuntimeException cause) {
            try {
                storage.abortMultipart(objectKey, storageSession.uploadId());
            } catch (RuntimeException ignored) {
                // 数据库失败是原始错误；对象存储清理失败交给生命周期规则兜底。
            }
            throw cause;
        }
        return new MultipartInitResult(
                row.getTaskId(), objectKey, row.getPartSize(), partCount(row),
                row.getExpiresAt().toInstant(ZoneOffset.UTC).toEpochMilli());
    }

    public MultipartStatusResult status(long userId, String taskId) {
        ImMediaUpload row = requireOwnedTask(userId, taskId);
        requireMember(row, userId);
        expireIfNeeded(row);
        List<MediaStorage.UploadedPart> parts = UPLOADING.equals(row.getStatus())
                ? storage.listParts(row.getObjectKey(), row.getUploadId())
                : List.of();
        return toStatus(row, parts);
    }

    public UploadPartPresignResult presignPart(long userId, String taskId, int partNumber) {
        ImMediaUpload row = requireActiveTask(userId, taskId);
        int count = partCount(row);
        if (partNumber < 1 || partNumber > count) {
            throw new BusinessException(400, "im.media.partInvalid");
        }
        long contentLength = expectedPartSize(row, partNumber, count);
        String url = storage.presignUploadPart(
                row.getObjectKey(), row.getUploadId(), partNumber, contentLength,
                Duration.ofSeconds(props.getPutTtlSeconds()));
        return new UploadPartPresignResult(partNumber, url, props.getPutTtlSeconds());
    }

    public MultipartStatusResult complete(long userId, String taskId) {
        ImMediaUpload row = requireOwnedTask(userId, taskId);
        requireMember(row, userId);
        if (COMPLETED.equals(row.getStatus())) {
            return toStatus(row, List.of());
        }
        requireUploading(row);
        List<MediaStorage.UploadedPart> parts = storage
                .listParts(row.getObjectKey(), row.getUploadId()).stream()
                .sorted(Comparator.comparingInt(MediaStorage.UploadedPart::partNumber))
                .toList();
        validateCompleteParts(row, parts);
        storage.completeMultipart(row.getObjectKey(), row.getUploadId(), parts);
        row.setStatus(COMPLETED);
        row.setUpdatedAt(LocalDateTime.now());
        mapper.updateById(row);
        return toStatus(row, parts);
    }

    public void abort(long userId, String taskId) {
        ImMediaUpload row = requireOwnedTask(userId, taskId);
        if (!UPLOADING.equals(row.getStatus())) {
            return;
        }
        storage.abortMultipart(row.getObjectKey(), row.getUploadId());
        row.setStatus(ABORTED);
        row.setUpdatedAt(LocalDateTime.now());
        mapper.updateById(row);
    }

    public List<ImMediaUpload> findExpired(LocalDateTime now) {
        return mapper.selectList(new LambdaQueryWrapper<ImMediaUpload>()
                .eq(ImMediaUpload::getStatus, UPLOADING)
                .le(ImMediaUpload::getExpiresAt, now));
    }

    public void expire(ImMediaUpload row) {
        if (!UPLOADING.equals(row.getStatus())) {
            return;
        }
        try {
            storage.abortMultipart(row.getObjectKey(), row.getUploadId());
        } finally {
            row.setStatus(EXPIRED);
            row.setUpdatedAt(LocalDateTime.now());
            mapper.updateById(row);
        }
    }

    private ImMediaUpload requireActiveTask(long userId, String taskId) {
        ImMediaUpload row = requireOwnedTask(userId, taskId);
        requireMember(row, userId);
        expireIfNeeded(row);
        requireUploading(row);
        return row;
    }

    private ImMediaUpload requireOwnedTask(long userId, String taskId) {
        if (taskId == null || taskId.isBlank()) {
            throw new BusinessException(400, "im.media.taskNotFound");
        }
        ImMediaUpload row = mapper.selectOne(new LambdaQueryWrapper<ImMediaUpload>()
                .eq(ImMediaUpload::getTaskId, taskId));
        if (row == null || row.getOwnerId() == null || row.getOwnerId() != userId) {
            throw new BusinessException(404, "im.media.taskNotFound");
        }
        return row;
    }

    private void requireMember(ImMediaUpload row, long userId) {
        if (!conversationService.isMember(row.getCid(), userId)) {
            throw new BusinessException(403, "im.conversation.notMember");
        }
    }

    private void expireIfNeeded(ImMediaUpload row) {
        if (UPLOADING.equals(row.getStatus()) && row.getExpiresAt().isBefore(LocalDateTime.now())) {
            expire(row);
        }
    }

    private void requireUploading(ImMediaUpload row) {
        if (!UPLOADING.equals(row.getStatus())) {
            throw new BusinessException(409, "im.media.taskNotUploading");
        }
    }

    private void validateCompleteParts(ImMediaUpload row, List<MediaStorage.UploadedPart> parts) {
        int count = partCount(row);
        if (parts.size() != count) {
            throw new BusinessException(409, "im.media.partsIncomplete");
        }
        long total = 0;
        for (int index = 0; index < parts.size(); index++) {
            MediaStorage.UploadedPart part = parts.get(index);
            int expectedNumber = index + 1;
            long expectedSize = expectedPartSize(row, expectedNumber, count);
            if (part.partNumber() != expectedNumber || part.size() != expectedSize
                    || part.eTag() == null || part.eTag().isBlank()) {
                throw new BusinessException(409, "im.media.partsInvalid");
            }
            total += part.size();
        }
        if (total != row.getTotalSize()) {
            throw new BusinessException(409, "im.media.partsInvalid");
        }
    }

    private MultipartStatusResult toStatus(ImMediaUpload row, List<MediaStorage.UploadedPart> parts) {
        List<UploadedPartResult> uploaded = parts.stream()
                .sorted(Comparator.comparingInt(MediaStorage.UploadedPart::partNumber))
                .map(part -> new UploadedPartResult(part.partNumber(), part.eTag(), part.size()))
                .toList();
        return new MultipartStatusResult(
                row.getTaskId(), row.getObjectKey(), row.getStatus(), row.getPartSize(),
                partCount(row), uploaded);
    }

    private int partCount(ImMediaUpload row) {
        return Math.toIntExact((row.getTotalSize() + row.getPartSize() - 1) / row.getPartSize());
    }

    private long expectedPartSize(ImMediaUpload row, int partNumber, int partCount) {
        return partNumber == partCount
                ? row.getTotalSize() - row.getPartSize() * (partCount - 1L)
                : row.getPartSize();
    }
}
