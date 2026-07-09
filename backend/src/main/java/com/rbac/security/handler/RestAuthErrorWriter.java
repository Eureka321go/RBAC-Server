package com.rbac.security.handler;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.common.Result;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 认证/授权失败时写出统一 {@link Result} JSON 的工具。
 */
final class RestAuthErrorWriter {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private RestAuthErrorWriter() {
    }

    static void write(HttpServletResponse response, int httpStatus, int code, String message) throws IOException {
        response.setStatus(httpStatus);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(MAPPER.writeValueAsString(Result.error(code, message)));
    }
}
