package com.rbac.system.post.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class PostSaveRequest {

    @NotBlank(message = "{valid.post.name.notBlank}")
    private String postName;

    @NotBlank(message = "{valid.post.code.notBlank}")
    private String postCode;

    private Integer sortOrder;

    @Pattern(regexp = "ENABLED|DISABLED", message = "{valid.status.pattern}")
    private String status;

    private String remark;
}
