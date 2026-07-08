package com.rbac.system.config.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ConfigSaveRequest {

    @NotBlank(message = "参数名称不能为空")
    private String configName;

    @NotBlank(message = "参数键不能为空")
    private String configKey;

    private String configValue;
    private String configType;
    private Boolean sensitive;
    private String remark;
}
