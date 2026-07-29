package com.rbac.im.mapper;

import com.rbac.im.entity.ImConversationMember;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** 里程碑9：mention_seq 前向单调批量推进。 */
@SpringBootTest
@ActiveProfiles("test")
class ImConversationMemberMentionSeqTest {

    private static final String CID = "g_99010";

    @Autowired
    private ImConversationMemberMapper mapper;

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void cleanup() {
        // uk_cid_user 不含 deleted，硬编码 cid 用物理删除清理
        jdbc.update("delete from im_conversation_member where cid = ?", CID);
    }

    private void insertMember(long userId, long mentionSeq) {
        ImConversationMember m = new ImConversationMember();
        m.setCid(CID);
        m.setUserId(userId);
        m.setLastReadSeq(0L);
        m.setMentionSeq(mentionSeq);
        m.setMuted(0);
        mapper.insert(m);
    }

    private long mentionSeqOf(long userId) {
        return jdbc.queryForObject(
                "select mention_seq from im_conversation_member where cid = ? and user_id = ?",
                Long.class, CID, userId);
    }

    @Test
    void advances_only_targets_and_is_forward_monotonic() {
        insertMember(1L, 0L);   // 目标，将被推进
        insertMember(2L, 0L);   // 目标，将被推进
        insertMember(3L, 0L);   // 非目标，保持 0
        insertMember(4L, 50L);  // 目标，但已有更大 seq，前向单调不回退

        int affected = mapper.advanceMentionSeq(CID, List.of(1L, 2L, 4L), 30L);

        // 只有 1、2 被真正更新（4 因 mention_seq=50 >= 30 不更新，3 不在 IN 集合）
        assertEquals(2, affected);
        assertEquals(30L, mentionSeqOf(1L));
        assertEquals(30L, mentionSeqOf(2L));
        assertEquals(0L, mentionSeqOf(3L));
        assertEquals(50L, mentionSeqOf(4L));
    }
}
