package com.rbac.system.role.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class RoleSaveRequest {

    @NotBlank(message = "角色名称不能为空")
    private String roleName;

    @NotBlank(message = "角色编码不能为空")
    private String roleCode;

    @Pattern(regexp = "ALL|CUSTOM_DEPT|OWN_DEPT|OWN_DEPT_CHILD|SELF", message = "数据范围非法")
    private String dataScope;

    private Integer sortOrder;

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态取值非法")
    private String status;

    private String remark;
}
