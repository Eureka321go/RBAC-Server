package com.rbac.system.user.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("sys_user")
public class SysUser extends BaseEntity {

    private Long deptId;
    private String username;
    private String nickname;
    private String password;
    private String email;
    private String phone;
    private String avatar;
    private String gender;
    private String status;
    private LocalDateTime lastLoginAt;
    private String lastLoginIp;
    private String remark;
}
