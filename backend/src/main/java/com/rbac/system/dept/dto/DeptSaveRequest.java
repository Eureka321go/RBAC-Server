package com.rbac.system.dept.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class DeptSaveRequest {

    private Long parentId;

    @NotBlank(message = "{valid.dept.name.notBlank}")
    private String deptName;

    private Long leaderUserId;
    private String phone;
    private String email;
    private Integer sortOrder;

    @Pattern(regexp = "ENABLED|DISABLED", message = "{valid.status.pattern}")
    private String status;
}
