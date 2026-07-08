package com.rbac.system.role.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class RoleSaveRequest {

    @NotBlank(message = "{valid.role.name.notBlank}")
    private String roleName;

    @NotBlank(message = "{valid.role.code.notBlank}")
    private String roleCode;

    @Pattern(regexp = "ALL|CUSTOM_DEPT|OWN_DEPT|OWN_DEPT_CHILD|SELF", message = "{valid.dataScope.pattern}")
    private String dataScope;

    private Integer sortOrder;

    @Pattern(regexp = "ENABLED|DISABLED", message = "{valid.status.pattern}")
    private String status;

    private String remark;
}
