package com.rbac.im.controller;

import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.service.ConversationService;
import com.rbac.security.model.LoginUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ImApiMockMvcTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ConversationService conversationService;
    @Autowired
    private ImMessageRepository repo;

    private String cid;

    private Authentication authAs(long userId) {
        LoginUser u = new LoginUser();
        u.setUserId(userId);
        u.setUsername("u" + userId);
        return new UsernamePasswordAuthenticationToken(u, null, List.of());
    }

    @BeforeEach
    void setup() {
        cid = conversationService.ensureSingleConversation(401, 402);
        repo.deleteAll(repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L));
        for (long s = 1; s <= 3; s++) {
            ImMessage m = new ImMessage();
            m.setCid(cid);
            m.setSeq(s);
            m.setMsgId("m" + s);
            m.setSenderId(401L);
            m.setType("TEXT");
            m.setBody(Map.of("text", "t" + s));
            m.setClientMsgId("cli-" + s);
            m.setTs(System.currentTimeMillis());
            repo.save(m);
        }
    }

    @Test
    void member_pulls_messages() throws Exception {
        mockMvc.perform(get("/im/messages").param("cid", cid).param("sinceSeq", "0")
                        .with(authentication(authAs(401))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.messages.length()").value(3))
                .andExpect(jsonPath("$.data.hasMore").value(false));
    }

    @Test
    void non_member_gets_403_in_body() throws Exception {
        mockMvc.perform(get("/im/messages").param("cid", cid)
                        .with(authentication(authAs(999))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(403));
    }

    @Test
    void conversations_list_returns_my_conversation() throws Exception {
        mockMvc.perform(get("/im/conversations").with(authentication(authAs(401))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[?(@.cid=='" + cid + "')]").exists());
    }
}
