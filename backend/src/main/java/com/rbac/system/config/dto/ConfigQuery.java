package com.rbac.system.config.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class ConfigQuery extends PageRequest {

    private String configName;
    private String configKey;
}
