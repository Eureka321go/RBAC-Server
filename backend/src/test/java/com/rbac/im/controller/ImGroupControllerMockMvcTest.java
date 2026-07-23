package com.rbac.im.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.security.model.LoginUser;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ImGroupControllerMockMvcTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;

    private Authentication authAs(long userId) {
        LoginUser u = new LoginUser();
        u.setUserId(userId);
        u.setUsername("u" + userId);
        return new UsernamePasswordAuthenticationToken(u, null, java.util.List.of());
    }

    @Test
    void createGroup_viaRest() throws Exception {
        String body = om.writeValueAsString(Map.of("name", "MVC群", "memberIds", java.util.List.of()));
        mvc.perform(post("/im/groups")
                        .with(authentication(authAs(8001L)))
                        .contentType("application/json").content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cid").value(org.hamcrest.Matchers.startsWith("g_")));
    }
}
