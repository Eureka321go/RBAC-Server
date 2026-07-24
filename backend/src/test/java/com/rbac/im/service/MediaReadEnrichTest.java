package com.rbac.im.service;

import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.ImMessageVO;
import com.rbac.im.vo.PullResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.Limit;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("test")
class MediaReadEnrichTest {

    @Autowired MessageQueryService queryService;
    @Autowired MessageAppender appender;
    @Autowired ImMessageRepository repo;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired ImConversationMemberMapper memberMapper;
    @Autowired JdbcTemplate jdbc;
    @MockBean MediaStorage storage;
    @MockBean OutboundDispatcher dispatcher;   // 捕获 push Envelope

    final String cid = "c_7301_7302";

    @BeforeEach
    void setup() {
        when(storage.presignGet(anyString(), any(Duration.class))).thenReturn("http://signed/get");
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(1000)));
        // uk_cid / uk_cid_user 不含 deleted 列，逻辑删除后同键再插会 DuplicateKeyException，改为物理删除以保证可重复运行。
        jdbc.update("delete from im_conversation where cid = ?", cid);
        jdbc.update("delete from im_conversation_member where cid = ?", cid);
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType("SINGLE"); c.setLastMsgSeq(0L);
        conversationMapper.insert(c);
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid); m.setUserId(7301L); m.setLastReadSeq(0L); m.setMentionSeq(0L); m.setMuted(0);
        memberMapper.insert(m);
    }

    @Test
    void pull_image_getsUrl_text_doesNot() {
        Map<String, Object> imgBody = new HashMap<>();
        imgBody.put("objectKey", "im/" + cid + "/199001/a.png");
        appender.append(cid, 7301L, "IMAGE", imgBody, "cm-img");
        appender.append(cid, 7301L, "TEXT", new HashMap<>(Map.of("text", "hi")), "cm-txt");

        PullResult r = queryService.pull(cid, 0L, 10, 7301L);
        ImMessageVO img = r.getMessages().stream().filter(v -> "IMAGE".equals(v.getType())).findFirst().orElseThrow();
        ImMessageVO txt = r.getMessages().stream().filter(v -> "TEXT".equals(v.getType())).findFirst().orElseThrow();

        assertThat(img.getBody().get("url")).isEqualTo("http://signed/get");
        assertThat(txt.getBody()).doesNotContainKey("url");

        // 持久化 body 不含 url
        ImMessage stored = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10)).stream()
                .filter(msg -> "IMAGE".equals(msg.getType())).findFirst().orElseThrow();
        assertThat(stored.getBody()).doesNotContainKey("url");
    }

    @Test
    void push_image_envelopeBody_hasUrl() {
        Map<String, Object> imgBody = new HashMap<>();
        imgBody.put("objectKey", "im/" + cid + "/199001/b.png");
        appender.append(cid, 7301L, "IMAGE", imgBody, "cm-push");

        verify(dispatcher).dispatch(eq(cid), argThat((Envelope env) ->
                "http://signed/get".equals(env.getBody().get("url"))));
    }
}
