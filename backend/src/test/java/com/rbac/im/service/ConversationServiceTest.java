package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@ActiveProfiles("test")
class ConversationServiceTest {

    @Autowired
    private ConversationService service;

    @Test
    void singleCid_is_order_independent() {
        assertEquals("c_2_5", service.singleCid(5, 2));
        assertEquals("c_2_5", service.singleCid(2, 5));
    }

    @Test
    void ensure_creates_two_members_idempotently() {
        String cid = service.ensureSingleConversation(11, 22);
        service.ensureSingleConversation(11, 22); // 再次调用不应重复建
        List<Long> members = service.memberUserIds(cid);
        assertEquals(List.of(11L, 22L), members.stream().sorted().toList());
    }
}
