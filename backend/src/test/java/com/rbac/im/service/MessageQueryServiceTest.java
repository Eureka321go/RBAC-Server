package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.vo.PullResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@ActiveProfiles("test")
class MessageQueryServiceTest {

    @Autowired
    private MessageQueryService service;
    @Autowired
    private ConversationService conversationService;
    @Autowired
    private ImMessageRepository repo;

    private String cid;

    @BeforeEach
    void setup() {
        cid = conversationService.ensureSingleConversation(301, 302);
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L));
        for (long s = 1; s <= 5; s++) {
            ImMessage m = new ImMessage();
            m.setCid(cid);
            m.setSeq(s);
            m.setMsgId("m" + s);
            m.setSenderId(301L);
            m.setType("TEXT");
            m.setBody(Map.of("text", "t" + s));
            m.setClientMsgId("cli-" + s);
            m.setTs(System.currentTimeMillis());
            repo.save(m);
        }
    }

    @Test
    void non_member_gets_403() {
        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.pull(cid, 0L, 50, 999L));
        assertEquals(403, ex.getCode());
    }

    @Test
    void incremental_since_seq() {
        PullResult r = service.pull(cid, 2L, 50, 301L);
        assertEquals(List.of(3L, 4L, 5L),
                r.getMessages().stream().map(v -> v.getSeq()).toList());
        assertFalse(r.isHasMore());
        assertEquals(5L, r.getNextSinceSeq());
    }

    @Test
    void paging_reports_has_more() {
        PullResult first = service.pull(cid, 0L, 2, 301L);
        assertEquals(List.of(1L, 2L),
                first.getMessages().stream().map(v -> v.getSeq()).toList());
        assertTrue(first.isHasMore());
        assertEquals(2L, first.getNextSinceSeq());

        PullResult next = service.pull(cid, first.getNextSinceSeq(), 2, 301L);
        assertEquals(List.of(3L, 4L),
                next.getMessages().stream().map(v -> v.getSeq()).toList());
        assertTrue(next.isHasMore());

        PullResult last = service.pull(cid, next.getNextSinceSeq(), 2, 301L);
        assertEquals(List.of(5L),
                last.getMessages().stream().map(v -> v.getSeq()).toList());
        assertFalse(last.isHasMore());
    }

    @Test
    void null_since_and_limit_use_defaults() {
        PullResult r = service.pull(cid, null, null, 301L);
        assertEquals(5, r.getMessages().size()); // 默认 limit 50，全量 5 条
        assertFalse(r.isHasMore());
    }

    @Test
    void pull_blanks_body_of_recalled_message() {
        ImMessage recalled = new ImMessage();
        recalled.setCid(cid);
        recalled.setSeq(6L);
        recalled.setMsgId("m6");
        recalled.setSenderId(301L);
        recalled.setType("TEXT");
        recalled.setBody(Map.of("text", "secret")); // 即便 body 未清干净
        recalled.setRecalled(true);
        recalled.setClientMsgId("cli-6");
        recalled.setTs(System.currentTimeMillis());
        repo.save(recalled);

        PullResult r = service.pull(cid, 5L, 50, 301L);

        assertEquals(1, r.getMessages().size());
        assertTrue(r.getMessages().get(0).isRecalled());
        assertTrue(r.getMessages().get(0).getBody().isEmpty()); // 正文不外泄
    }
}
