package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.config.MediaProperties;
import com.rbac.im.vo.PresignResult;
import com.rbac.im.vo.DownloadPresignResult;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** 富媒体：上传预签名 + 发送校验。对象存储访问全部经 {@link MediaStorage} 端口。 */
@Service
public class MediaService {

    private static final Set<String> MEDIA_TYPES = Set.of("IMAGE", "AUDIO", "FILE");
    private static final DateTimeFormatter YM = DateTimeFormatter.ofPattern("yyyyMM");
    /** 客户端 filename 里能被接受的扩展名形态（含点），其余一律丢弃。 */
    private static final Pattern EXT = Pattern.compile("\\.[a-z0-9]{1,10}");

    private final MediaProperties props;
    private final MediaStorage storage;
    private final ConversationService conversationService;

    public MediaService(MediaProperties props, MediaStorage storage, ConversationService conversationService) {
        this.props = props;
        this.storage = storage;
        this.conversationService = conversationService;
    }

    /** null-safe：{@code Set.of(...).contains(null)} 会抛 NPE，缺 type 的报文不能炸消费线程。 */
    public static boolean isMedia(String type) {
        return type != null && MEDIA_TYPES.contains(type);
    }

    /** 上传预签名：成员 + 白名单 + 大小校验，生成 objectKey 与预签名 PUT URL。 */
    public PresignResult presign(long userId, String cid, String type, String filename, String mime, long size) {
        validateUploadRequest(userId, cid, type, mime, size);
        String objectKey = buildObjectKey(cid, filename);
        // 申报的 size/mime 一并入签名：客户端拿到 URL 后无法再改字节数或 Content-Type
        String uploadUrl = storage.presignPut(objectKey, size, mime, Duration.ofSeconds(props.getPutTtlSeconds()));
        return new PresignResult(objectKey, uploadUrl, props.getPutTtlSeconds());
    }

    public void validateUploadRequest(long userId, String cid, String type, String mime, long size) {
        if (!conversationService.isMember(cid, userId)) {
            throw new BusinessException(403, "im.conversation.notMember");
        }
        MediaProperties.Limit limit = props.limitFor(type);
        if (limit == null) {
            throw new BusinessException(400, "im.media.typeUnsupported");
        }
        if (!mimeAllowed(limit.getMimes(), mime)) {
            throw new BusinessException(400, "im.media.mimeNotAllowed");
        }
        if (size <= 0 || size > limit.getMaxSize()) {
            throw new BusinessException(400, "im.media.tooLarge");
        }
    }

    /** 为缓存中的过期 GET URL 签发新地址；当前用户必须仍在会话中。 */
    public DownloadPresignResult presignDownload(long userId, String cid, String objectKey) {
        if (!conversationService.isMember(cid, userId)) {
            throw new BusinessException(403, "im.conversation.notMember");
        }
        if (!objectKeyBelongsToConversation(cid, objectKey) || storage.stat(objectKey).isEmpty()) {
            throw new BusinessException(404, "im.media.objectNotFound");
        }
        String url = storage.presignGet(objectKey, Duration.ofSeconds(props.getGetTtlSeconds()));
        return new DownloadPresignResult(objectKey, url, props.getGetTtlSeconds());
    }

    private boolean mimeAllowed(List<String> mimes, String mime) {
        return mimes.contains("*") || (mime != null && mimes.contains(mime));
    }

    /**
     * 发送媒体消息前校验：objectKey 须为本服务给本会话签发的形态、对象真实存在，
     * 且 HEAD 回来的权威 size/mime 仍满足该消息类型的上限；通过后用 HEAD 值回填。
     * <p>复核 HEAD 结果是必须的：预签名时的申报值只约束上传那一跳，
     * 且用 FILE（100MB / mimes "*"）预签名的对象可以改用 IMAGE 类型发送。
     */
    public void validateForSend(String cid, String type, Map<String, Object> body) {
        if (cid == null || body == null || !(body.get("objectKey") instanceof String objectKey)
                || !objectKeyPattern(cid).matcher(objectKey).matches()) {
            throw new MediaValidationException("INVALID_OBJECT");
        }
        MediaProperties.Limit limit = props.limitFor(type);
        if (limit == null) {
            throw new MediaValidationException("TYPE_UNSUPPORTED");
        }
        MediaStorage.ObjectStat stat = storage.stat(objectKey)
                .orElseThrow(() -> new MediaValidationException("OBJECT_NOT_FOUND"));
        if (stat.size() > limit.getMaxSize()) {
            throw new MediaValidationException("TOO_LARGE");
        }
        if (!mimeAllowed(limit.getMimes(), stat.contentType())) {
            throw new MediaValidationException("MIME_NOT_ALLOWED");
        }
        body.put("size", stat.size());
        body.put("mime", stat.contentType());
    }

    /**
     * 归属校验：只接受 {@link #buildKey} 生成的完整形态，而不是裸 startsWith
     * （后者会放过 {@code im/c_1_2/../c_9_9/x.png} 这类依赖存储端路径规整的 key）。
     */
    private static Pattern objectKeyPattern(String cid) {
        return Pattern.compile("^im/" + Pattern.quote(cid) + "/\\d{6}/[0-9a-f]{32}(\\.[a-z0-9]{1,10})?$");
    }

    public static boolean objectKeyBelongsToConversation(String cid, String objectKey) {
        return cid != null && objectKey != null && objectKeyPattern(cid).matcher(objectKey).matches();
    }

    public String buildObjectKey(String cid, String filename) {
        String ext = "";
        if (filename != null) {
            int dot = filename.lastIndexOf('.');
            if (dot >= 0 && dot < filename.length() - 1) {
                String candidate = filename.substring(dot).toLowerCase(Locale.ROOT);
                // 客户端 filename 不可信：超长 / 含分隔符或空白的扩展名一律丢弃
                if (EXT.matcher(candidate).matches()) {
                    ext = candidate;
                }
            }
        }
        String ym = LocalDate.now().format(YM);
        String uuid = UUID.randomUUID().toString().replace("-", "");
        return "im/" + cid + "/" + ym + "/" + uuid + ext;
    }

    public String safeFilename(String filename) {
        if (filename == null || filename.isBlank()) {
            return "file";
        }
        String normalized = filename.replace('\\', '/');
        String basename = normalized.substring(normalized.lastIndexOf('/') + 1).trim();
        if (basename.isEmpty()) {
            return "file";
        }
        return basename.length() > 255 ? basename.substring(basename.length() - 255) : basename;
    }
}
