package com.rbac.system.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class UserCreateRequest {

    @NotBlank(message = "账号不能为空")
    @Size(min = 2, max = 32, message = "账号长度 2-32")
    private String username;

    @NotBlank(message = "昵称不能为空")
    private String nickname;

    /** 初始密码，为空则使用系统默认密码。 */
    private String password;

    private Long deptId;
    private String email;
    private String phone;
    private String gender;

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态取值非法")
    private String status;

    private String remark;
    private List<Long> roleIds = new ArrayList<>();
}
