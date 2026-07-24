package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.Limit;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("test")
class MediaSendCheckTest {

    @Autowired InboundMessageConsumer consumer;
    @Autowired ImMessageRepository repo;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired ImConversationMemberMapper memberMapper;
    @Autowired JdbcTemplate jdbc;
    @MockBean MediaStorage storage;
    @MockBean OutboundDispatcher dispatcher;

    final ObjectMapper om = new ObjectMapper();
    final String cid = "c_7201_7202";

    @BeforeEach
    void setup() {
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(1000)));
        // uk_cid / uk_cid_user 不含 deleted 列，逻辑删除后同键再插会 DuplicateKeyException，改为物理删除以保证可重复运行。
        jdbc.update("delete from im_conversation where cid = ?", cid);
        jdbc.update("delete from im_conversation_member where cid = ?", cid);
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType("SINGLE"); c.setLastMsgSeq(0L);
        conversationMapper.insert(c);
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid); m.setUserId(7201L); m.setLastReadSeq(0L); m.setMentionSeq(0L); m.setMuted(0);
        memberMapper.insert(m);
    }

    /** 本服务签发的 key 形态：im/{cid}/{yyyyMM}/{32位hex}[.ext] */
    private String key(String c) {
        return "im/" + c + "/199001/0123456789abcdef0123456789abcdef.png";
    }

    private String mediaJson(String type, String objectKey) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND"); e.setCid(cid); e.setSenderId(7201L);
        e.setType(type);
        Map<String, Object> body = new HashMap<>();
        body.put("objectKey", objectKey);
        body.put("size", 1);        // 客户端自报，应被 HEAD 覆盖
        e.setBody(body);
        e.setClientMsgId("cm-" + type + "-" + objectKey.hashCode() + "-" + System.nanoTime());
        return om.writeValueAsString(e);
    }

    private String imageJson(String objectKey) throws Exception {
        return mediaJson("IMAGE", objectKey);
    }

    private void assertNothingPersisted() {
        assertThat(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10))).isEmpty();
    }

    private void assertErrorPushed(String reason) {
        verify(dispatcher).dispatchToUser(eq(7201L), argThat(env ->
                "ERROR".equals(env.getOp()) && reason.equals(env.getBody().get("reason"))));
    }

    @Test
    void wrongPrefix_dropped_andError() throws Exception {
        consumer.onMessage(imageJson(key("c_OTHER")));   // 前缀不属本会话
        assertNothingPersisted();
        assertErrorPushed("INVALID_OBJECT");
    }

    /** I4：`..` 逃逸不能靠存储端路径规整兜底，key 形态必须整体匹配。 */
    @Test
    void dotDotTraversalKey_dropped_andError() throws Exception {
        consumer.onMessage(imageJson("im/" + cid + "/../c_9_9/199001/0123456789abcdef0123456789abcdef.png"));
        assertNothingPersisted();
        assertErrorPushed("INVALID_OBJECT");
        verify(storage, never()).stat(anyString());
    }

    @Test
    void objectMissing_dropped_andError() throws Exception {
        when(storage.stat(anyString())).thenReturn(Optional.empty());
        consumer.onMessage(imageJson(key(cid)));
        assertNothingPersisted();
        assertErrorPushed("OBJECT_NOT_FOUND");
    }

    /** C1：HEAD 回来的权威 size 超该类型上限 → 拒绝（预签名时的申报值不可信）。 */
    @Test
    void headSizeOverLimit_dropped_andError() throws Exception {
        when(storage.stat(anyString()))   // image 上限 10MB
                .thenReturn(Optional.of(new MediaStorage.ObjectStat(5L * 1024 * 1024 * 1024, "image/png")));
        consumer.onMessage(imageJson(key(cid)));
        assertNothingPersisted();
        assertErrorPushed("TOO_LARGE");
    }

    /** C1：HEAD 回来的权威 mime 不在该类型白名单 → 拒绝（否则可从源站投递 HTML）。 */
    @Test
    void headMimeNotAllowed_dropped_andError() throws Exception {
        when(storage.stat(anyString()))
                .thenReturn(Optional.of(new MediaStorage.ObjectStat(1024L, "text/html")));
        consumer.onMessage(imageJson(key(cid)));
        assertNothingPersisted();
        assertErrorPushed("MIME_NOT_ALLOWED");
    }

    /** C1 次生：用 FILE（100MB / mimes "*"）预签名的对象，改用 IMAGE 类型发送同样要被拦。 */
    @Test
    void objectPresignedAsFile_sentAsImage_dropped_andError() throws Exception {
        when(storage.stat(anyString()))
                .thenReturn(Optional.of(new MediaStorage.ObjectStat(50L * 1024 * 1024, "application/zip")));
        consumer.onMessage(mediaJson("IMAGE", key(cid)));
        assertNothingPersisted();
        assertErrorPushed("TOO_LARGE");   // 50MB 已超 image 的 10MB 上限
    }

    /** I5：对象存储故障不能逃出 onMessage（会被 Kafka 重试后静默丢弃），要回通用码。 */
    @Test
    void storageFailure_dropped_andGenericError() throws Exception {
        when(storage.stat(anyString()))
                .thenThrow(new IllegalStateException("connect timed out to minio-internal:9000"));
        consumer.onMessage(imageJson(key(cid)));
        assertNothingPersisted();
        assertErrorPushed("STORAGE_UNAVAILABLE");
        // 不外泄 SDK 异常细节
        verify(dispatcher).dispatchToUser(eq(7201L), argThat(env ->
                !String.valueOf(env.getBody().get("reason")).contains("minio-internal")));
    }

    /** I3：缺 type 的报文不能抛 NPE 炸掉消费线程。 */
    @Test
    void nullType_doesNotThrow() throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND"); e.setCid(cid); e.setSenderId(7201L);
        e.setType(null);
        e.setBody(new HashMap<>(Map.of("text", "hi")));
        e.setClientMsgId("cm-null-type-" + System.nanoTime());
        consumer.onMessage(om.writeValueAsString(e));   // 不抛异常即通过

        List<ImMessage> rows = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10));
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getType()).isNull();
    }

    @Test
    void valid_persisted_withBackfilledSizeMime() throws Exception {
        when(storage.stat(anyString()))
                .thenReturn(Optional.of(new MediaStorage.ObjectStat(20480L, "image/png")));
        consumer.onMessage(imageJson(key(cid)));

        List<ImMessage> rows = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10));
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getBody().get("size")).isEqualTo(20480L);   // HEAD 值覆盖客户端自报的 1
        assertThat(rows.get(0).getBody().get("mime")).isEqualTo("image/png");
    }
}
