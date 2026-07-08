package com.rbac.system.dict.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class DictDataSaveRequest {

    @NotNull(message = "字典类型不能为空")
    private Long dictTypeId;

    @NotBlank(message = "字典标签不能为空")
    private String label;

    @NotBlank(message = "字典键值不能为空")
    private String value;

    private Integer sortOrder;
    private Boolean defaultFlag;

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态取值非法")
    private String status;

    private String remark;
}
