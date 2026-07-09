package com.rbac.system.user.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class UserQuery extends PageRequest {

    private String username;
    private String nickname;
    private String phone;
    private Long deptId;
    private String status;
}
