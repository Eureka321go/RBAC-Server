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

    private String imageJson(String objectKey) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND"); e.setCid(cid); e.setSenderId(7201L);
        e.setType("IMAGE");
        Map<String, Object> body = new HashMap<>();
        body.put("objectKey", objectKey);
        body.put("size", 1);        // 客户端自报，应被 HEAD 覆盖
        e.setBody(body);
        e.setClientMsgId("cm-" + objectKey.hashCode());
        return om.writeValueAsString(e);
    }

    @Test
    void wrongPrefix_dropped_andError() throws Exception {
        consumer.onMessage(imageJson("im/c_OTHER/199001/x.png"));   // 前缀不属本会话
        assertThat(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10))).isEmpty();
        verify(dispatcher).dispatchToUser(eq(7201L), argThat(env ->
                "ERROR".equals(env.getOp()) && "INVALID_OBJECT".equals(env.getBody().get("reason"))));
    }

    @Test
    void objectMissing_dropped_andError() throws Exception {
        when(storage.stat(anyString())).thenReturn(Optional.empty());
        consumer.onMessage(imageJson("im/" + cid + "/199001/x.png"));
        assertThat(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10))).isEmpty();
        verify(dispatcher).dispatchToUser(eq(7201L), argThat(env ->
                "OBJECT_NOT_FOUND".equals(env.getBody().get("reason"))));
    }

    @Test
    void valid_persisted_withBackfilledSizeMime() throws Exception {
        when(storage.stat(anyString()))
                .thenReturn(Optional.of(new MediaStorage.ObjectStat(20480L, "image/png")));
        consumer.onMessage(imageJson("im/" + cid + "/199001/x.png"));

        List<ImMessage> rows = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10));
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getBody().get("size")).isEqualTo(20480);   // HEAD 值覆盖客户端自报的 1
        assertThat(rows.get(0).getBody().get("mime")).isEqualTo("image/png");
    }
}
