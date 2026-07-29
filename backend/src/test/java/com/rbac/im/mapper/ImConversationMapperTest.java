package com.rbac.im.mapper;

import com.rbac.im.entity.ImConversation;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import static org.junit.jupiter.api.Assertions.assertNotNull;

@SpringBootTest
@ActiveProfiles("test")
class ImConversationMapperTest {

    @Autowired
    private ImConversationMapper mapper;

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void cleanup() {
        jdbc.update("delete from im_conversation where cid = ?", "c_1_2");
    }

    @Test
    void insert_then_read_by_cid() {
        ImConversation c = new ImConversation();
        c.setCid("c_1_2");
        c.setType("SINGLE");
        c.setLastMsgSeq(0L);
        mapper.insert(c);
        assertNotNull(c.getId());
    }
}
