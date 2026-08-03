package com.rbac.im.push.registration;

import com.rbac.common.web.GlobalExceptionHandler;
import com.rbac.security.model.LoginUser;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ImPushRegistrationController.class)
@AutoConfigureMockMvc(addFilters = false)
@Import(GlobalExceptionHandler.class)
@ContextConfiguration(classes = ImPushRegistrationControllerTest.TestApplication.class)
class ImPushRegistrationControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private PushRegistrationService service;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.getContext().setAuthentication(authAs(42L));
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void put_derivesUserFromSecurityContext_andReturns204() throws Exception {
        mvc.perform(put("/im/push/registrations/device-a")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody()))
                .andExpect(status().isNoContent());

        ArgumentCaptor<PushRegistrationRequest> request = ArgumentCaptor.forClass(PushRegistrationRequest.class);
        verify(service).upsert(eq(42L), eq("device-a"), request.capture());
        assertThat(request.getValue().targetValue()).isEqualTo("fid-a");
    }

    @Test
    void delete_derivesUserFromSecurityContext_andReturns204() throws Exception {
        mvc.perform(delete("/im/push/registrations/device-a"))
                .andExpect(status().isNoContent());

        verify(service).disable(42L, "device-a");
    }

    @Test
    void put_rejectsOversizedDeviceId() throws Exception {
        mvc.perform(put("/im/push/registrations/" + "d".repeat(65))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void put_rejectsInvalidRequestBody() throws Exception {
        mvc.perform(put("/im/push/registrations/device-a")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"platform\":\"IOS\",\"provider\":\"FCM\",\"targetType\":\"FID\",\"targetValue\":\"fid-a\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void put_rejectsUnauthenticatedRequestWithoutCallingService() throws Exception {
        SecurityContextHolder.clearContext();

        mvc.perform(put("/im/push/registrations/device-a")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(401));

        verify(service, never()).upsert(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any());
    }

    private Authentication authAs(long userId) {
        LoginUser user = new LoginUser();
        user.setUserId(userId);
        user.setUsername("u" + userId);
        return new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities());
    }

    private String validBody() {
        return """
                {"platform":"ANDROID","provider":"FCM","targetType":"FID",
                 "targetValue":"fid-a","appVersion":"1.0"}
                """;
    }

    @SpringBootConfiguration
    @Import({ImPushRegistrationController.class, GlobalExceptionHandler.class})
    static class TestApplication {
    }
}
