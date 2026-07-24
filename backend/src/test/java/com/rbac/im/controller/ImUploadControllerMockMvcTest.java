package com.rbac.im.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.service.MediaStorage;
import com.rbac.security.model.LoginUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ImUploadControllerMockMvcTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired ImConversationMemberMapper memberMapper;
    @Autowired JdbcTemplate jdbc;
    @MockBean MediaStorage storage;   // 隔离真实 MinIO

    final String cid = "c_7001_7002";

    private Authentication authAs(long userId) {
        LoginUser u = new LoginUser();
        u.setUserId(userId);
        u.setUsername("u" + userId);
        return new UsernamePasswordAuthenticationToken(u, null, List.of());
    }

    @BeforeEach
    void setup() {
        when(storage.presignPut(any(), any(Duration.class))).thenReturn("http://signed/put");
        // 物理清理：im_conversation/im_conversation_member 的唯一键不含 deleted，
        // mapper.delete() 是逻辑删除，同 cid 复用会撞 uk_cid / uk_cid_user（见项目已知坑）。
        jdbc.update("DELETE FROM im_conversation_member WHERE cid = ?", cid);
        jdbc.update("DELETE FROM im_conversation WHERE cid = ?", cid);
        ImConversation c = new ImConversation();
        c.setCid(cid); c.setType("SINGLE"); c.setLastMsgSeq(0L);
        conversationMapper.insert(c);
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid); m.setUserId(7001L); m.setLastReadSeq(0L); m.setMentionSeq(0L); m.setMuted(0);
        memberMapper.insert(m);
    }

    private String body(String type, String mime, long size) throws Exception {
        return om.writeValueAsString(Map.of(
                "cid", cid, "type", type, "filename", "p.png", "mime", mime, "size", size));
    }

    @Test
    void member_getsPresignedUrl() throws Exception {
        mvc.perform(post("/im/upload/presign").with(authentication(authAs(7001L)))
                        .contentType("application/json").content(body("IMAGE", "image/png", 1024)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.uploadUrl").value("http://signed/put"))
                .andExpect(jsonPath("$.data.objectKey").value(org.hamcrest.Matchers.startsWith("im/" + cid + "/")));
    }

    @Test
    void nonMember_rejected() throws Exception {
        mvc.perform(post("/im/upload/presign").with(authentication(authAs(9999L)))
                        .contentType("application/json").content(body("IMAGE", "image/png", 1024)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(403));
    }

    @Test
    void mimeNotAllowed_rejected() throws Exception {
        mvc.perform(post("/im/upload/presign").with(authentication(authAs(7001L)))
                        .contentType("application/json").content(body("IMAGE", "application/x-msdownload", 1024)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void tooLarge_rejected() throws Exception {
        mvc.perform(post("/im/upload/presign").with(authentication(authAs(7001L)))
                        .contentType("application/json").content(body("IMAGE", "image/png", 99999999L)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }
}
