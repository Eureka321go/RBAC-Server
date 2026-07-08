package com.rbac.system.dict.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class DictDataSaveRequest {

    @NotNull(message = "{valid.dict.type.notNull}")
    private Long dictTypeId;

    @NotBlank(message = "{valid.dict.label.notBlank}")
    private String label;

    @NotBlank(message = "{valid.dict.value.notBlank}")
    private String value;

    private Integer sortOrder;
    private Boolean defaultFlag;

    @Pattern(regexp = "ENABLED|DISABLED", message = "{valid.status.pattern}")
    private String status;

    private String remark;
}
