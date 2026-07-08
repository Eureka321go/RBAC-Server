package com.rbac.common.domain;

import jakarta.validation.constraints.Pattern;
import lombok.Data;

/**
 * 通用状态更新请求。status 仅允许 ENABLED / DISABLED。
 */
@Data
public class StatusUpdateRequest {

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态取值非法")
    private String status;
}
