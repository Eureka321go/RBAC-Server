package com.rbac.system.dict.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class DictTypeSaveRequest {

    @NotBlank(message = "{valid.dict.name.notBlank}")
    private String dictName;

    @NotBlank(message = "{valid.dict.code.notBlank}")
    private String dictCode;

    @Pattern(regexp = "ENABLED|DISABLED", message = "{valid.status.pattern}")
    private String status;

    private String remark;
}
