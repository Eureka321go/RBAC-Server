package com.rbac.im.vo;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class PresignResult {
    private String objectKey;
    private String uploadUrl;
    private long expiresIn;
}
