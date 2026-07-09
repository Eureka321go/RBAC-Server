package com.rbac.system.config.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ConfigSaveRequest {

    @NotBlank(message = "{valid.config.name.notBlank}")
    private String configName;

    @NotBlank(message = "{valid.config.key.notBlank}")
    private String configKey;

    private String configValue;
    private String configType;
    private Boolean sensitive;
    private String remark;
}
