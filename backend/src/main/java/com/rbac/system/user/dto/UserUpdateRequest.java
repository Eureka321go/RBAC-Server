package com.rbac.system.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class UserUpdateRequest {

    @NotBlank(message = "昵称不能为空")
    private String nickname;

    private Long deptId;
    private String email;
    private String phone;
    private String gender;

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态取值非法")
    private String status;

    private String remark;
    private List<Long> roleIds = new ArrayList<>();
}
