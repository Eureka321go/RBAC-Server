package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.config.MediaProperties;
import com.rbac.im.vo.PresignResult;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** 富媒体：上传预签名 + 发送校验。对象存储访问全部经 {@link MediaStorage} 端口。 */
@Service
public class MediaService {

    private static final Set<String> MEDIA_TYPES = Set.of("IMAGE", "AUDIO", "FILE");
    private static final DateTimeFormatter YM = DateTimeFormatter.ofPattern("yyyyMM");

    private final MediaProperties props;
    private final MediaStorage storage;
    private final ConversationService conversationService;

    public MediaService(MediaProperties props, MediaStorage storage, ConversationService conversationService) {
        this.props = props;
        this.storage = storage;
        this.conversationService = conversationService;
    }

    public static boolean isMedia(String type) {
        return MEDIA_TYPES.contains(type);
    }

    /** 上传预签名：成员 + 白名单 + 大小校验，生成 objectKey 与预签名 PUT URL。 */
    public PresignResult presign(long userId, String cid, String type, String filename, String mime, long size) {
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
        String objectKey = buildKey(cid, filename);
        String uploadUrl = storage.presignPut(objectKey, Duration.ofSeconds(props.getPutTtlSeconds()));
        return new PresignResult(objectKey, uploadUrl, props.getPutTtlSeconds());
    }

    private boolean mimeAllowed(List<String> mimes, String mime) {
        return mimes.contains("*") || (mime != null && mimes.contains(mime));
    }

    /** 发送媒体消息前校验：objectKey 须属本会话且对象真实存在；成功则用 HEAD 回填权威 size/mime。 */
    public void validateForSend(String cid, Map<String, Object> body) {
        if (body == null || !(body.get("objectKey") instanceof String objectKey)
                || !objectKey.startsWith("im/" + cid + "/")) {
            throw new MediaValidationException("INVALID_OBJECT");
        }
        MediaStorage.ObjectStat stat = storage.stat(objectKey)
                .orElseThrow(() -> new MediaValidationException("OBJECT_NOT_FOUND"));
        // 存为 int：与客户端自报字段（Jackson 反序列化的 JSON number）类型一致，
        // 避免 Mongo 落库后 Long/Integer 类型不一致；媒体大小受 MediaProperties 限制，远小于 Integer.MAX_VALUE。
        body.put("size", (int) stat.size());
        body.put("mime", stat.contentType());
    }

    private String buildKey(String cid, String filename) {
        String ext = "";
        if (filename != null) {
            int dot = filename.lastIndexOf('.');
            if (dot >= 0 && dot < filename.length() - 1) {
                ext = filename.substring(dot).toLowerCase();
            }
        }
        String ym = LocalDate.now().format(YM);
        String uuid = UUID.randomUUID().toString().replace("-", "");
        return "im/" + cid + "/" + ym + "/" + uuid + ext;
    }
}
