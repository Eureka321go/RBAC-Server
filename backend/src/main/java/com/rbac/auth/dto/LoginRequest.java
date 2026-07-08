package com.rbac.auth.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class LoginRequest {

    @NotBlank(message = "{valid.username.notBlank}")
    private String username;

    @NotBlank(message = "{valid.password.notBlank}")
    private String password;

    /** 验证码预留字段。 */
    private String captchaKey;
    private String captchaCode;
}
