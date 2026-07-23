package com.rbac.im.doc;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@ActiveProfiles("test")
class ImMessageRepositoryTest {

    @Autowired
    private ImMessageRepository repo;

    @Test
    void save_and_pull_incremental() {
        // 清理本会话旧数据，保证 cid_seq 唯一索引下测试可重复运行
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc("c_1_2", 0L));

        ImMessage m = new ImMessage();
        m.setCid("c_1_2");
        m.setSeq(1L);
        m.setMsgId("m1");
        m.setSenderId(1L);
        m.setType("TEXT");
        m.setBody(Map.of("text", "hi"));
        m.setClientMsgId("cli-1");
        m.setTs(System.currentTimeMillis());
        repo.save(m);

        List<ImMessage> got = repo.findByCidAndSeqGreaterThanOrderBySeqAsc("c_1_2", 0L);
        assertEquals(1, got.size());
        assertEquals("hi", got.get(0).getBody().get("text"));
    }
}
