package com.rbac.system.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class PasswordResetRequest {

    @NotBlank(message = "{valid.password.newNotBlank}")
    @Size(min = 6, max = 32, message = "{valid.password.size}")
    private String password;
}
