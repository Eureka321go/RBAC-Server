package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.mapper.ImConversationMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Limit;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class MessageAppenderTest {

    @Autowired MessageAppender appender;
    @Autowired ImMessageRepository repo;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired JdbcTemplate jdbcTemplate;

    String cid = "c_9001_9002";

    @BeforeEach
    void clean() {
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(1000)));
        // 物理删除而非 conversationMapper.delete(...)：im_conversation.uk_cid 是纯 UNIQUE(cid)，
        // 不含 deleted 列，而 @TableLogic 的 delete() 只是 UPDATE deleted=1（逻辑删除），
        // 物理行仍占用 uk_cid，导致本方法内随后的 insert 必然抛 DuplicateKeyException。
        // 详见 task-1-report.md 中的问题记录。
        jdbcTemplate.update("DELETE FROM im_conversation WHERE cid = ?", cid);
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType("SINGLE"); c.setLastMsgSeq(0L);
        conversationMapper.insert(c);
    }

    @Test
    void append_saves_updatesSummary_returnsSeq() {
        long seq = appender.append(cid, 9001L, "TEXT", Map.of("text", "在吗"), "cm-1");

        List<ImMessage> rows = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(10));
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getSeq()).isEqualTo(seq);
        assertThat(rows.get(0).getType()).isEqualTo("TEXT");

        ImConversation c = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        assertThat(c.getLastMsgSeq()).isEqualTo(seq);
        assertThat(c.getLastMsgPreview()).isEqualTo("在吗");
    }

    @Test
    void preview_forSystem_isPlaceholder() {
        assertThat(MessageAppender.preview("SYSTEM", Map.of("event", "MEMBER_JOIN"))).isEqualTo("[系统消息]");
    }
}
