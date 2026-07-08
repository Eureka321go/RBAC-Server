package com.rbac.system.role.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class RoleQuery extends PageRequest {

    private String roleName;
    private String roleCode;
    private String status;
}
