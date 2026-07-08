package com.rbac.system.dept.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class DeptSaveRequest {

    private Long parentId;

    @NotBlank(message = "部门名称不能为空")
    private String deptName;

    private Long leaderUserId;
    private String phone;
    private String email;
    private Integer sortOrder;

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态取值非法")
    private String status;
}
