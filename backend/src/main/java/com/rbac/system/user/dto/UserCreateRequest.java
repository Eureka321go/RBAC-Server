package com.rbac.system.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class UserCreateRequest {

    @NotBlank(message = "{valid.username.notBlank}")
    @Size(min = 2, max = 32, message = "{valid.username.size}")
    private String username;

    @NotBlank(message = "{valid.nickname.notBlank}")
    private String nickname;

    @Size(max = 500)
    private String profile;

    /** 初始密码，为空则使用系统默认密码。 */
    private String password;

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
