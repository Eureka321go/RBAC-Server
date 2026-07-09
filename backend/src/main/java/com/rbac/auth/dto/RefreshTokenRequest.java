package com.rbac.auth.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RefreshTokenRequest {

    @NotBlank(message = "{valid.refreshToken.notBlank}")
    private String refreshToken;
}
