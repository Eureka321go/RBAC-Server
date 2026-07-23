package com.rbac.im.doc;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@ActiveProfiles("test")
class ImMessageRepositoryPageTest {

    private static final String CID = "c_page_1";

    @Autowired
    private ImMessageRepository repo;

    @BeforeEach
    void clean() {
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(CID, 0L));
    }

    private void save(long seq) {
        ImMessage m = new ImMessage();
        m.setCid(CID);
        m.setSeq(seq);
        m.setMsgId("m" + seq);
        m.setSenderId(1L);
        m.setType("TEXT");
        m.setBody(Map.of("text", "t" + seq));
        m.setClientMsgId("cli-" + seq);
        m.setTs(System.currentTimeMillis());
        repo.save(m);
    }

    @Test
    void since_and_limit_returns_ascending_slice() {
        for (long s = 1; s <= 5; s++) {
            save(s);
        }
        List<ImMessage> got = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(CID, 2L, Limit.of(2));
        assertEquals(2, got.size());
        assertEquals(3L, got.get(0).getSeq());
        assertEquals(4L, got.get(1).getSeq());
    }
}
