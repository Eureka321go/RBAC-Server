package com.rbac.security.handler;

import com.rbac.common.util.MessageUtils;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;

/** 未认证访问受保护资源时返回 401。 */
@Component
public class JwtAuthenticationEntryPoint implements AuthenticationEntryPoint {

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException authException) throws IOException {
        RestAuthErrorWriter.write(response, HttpServletResponse.SC_UNAUTHORIZED, 401,
                MessageUtils.get(request.getLocale(), "auth.notLoggedIn"));
    }
}
