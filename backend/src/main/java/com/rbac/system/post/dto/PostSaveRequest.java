package com.rbac.system.post.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class PostSaveRequest {

    @NotBlank(message = "岗位名称不能为空")
    private String postName;

    @NotBlank(message = "岗位编码不能为空")
    private String postCode;

    private Integer sortOrder;

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态取值非法")
    private String status;

    private String remark;
}
