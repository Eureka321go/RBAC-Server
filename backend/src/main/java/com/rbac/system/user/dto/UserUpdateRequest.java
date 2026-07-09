package com.rbac.system.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class UserUpdateRequest {

    @NotBlank(message = "{valid.nickname.notBlank}")
    private String nickname;

    private Long deptId;
    private String email;
    private String phone;
    private String gender;

    @Pattern(regexp = "ENABLED|DISABLED", message = "{valid.status.pattern}")
    private String status;

    private String remark;
    private List<Long> roleIds = new ArrayList<>();
    private List<Long> postIds = new ArrayList<>();
}
