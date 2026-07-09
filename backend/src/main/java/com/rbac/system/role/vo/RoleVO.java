package com.rbac.system.role.vo;

import com.rbac.system.role.entity.SysRole;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class RoleVO {

    private Long id;
    private String roleName;
    private String roleCode;
    private String dataScope;
    private Boolean builtin;
    private Integer sortOrder;
    private String status;
    private String remark;
    private LocalDateTime createdAt;

    public static RoleVO from(SysRole r) {
        RoleVO vo = new RoleVO();
        vo.setId(r.getId());
        vo.setRoleName(r.getRoleName());
        vo.setRoleCode(r.getRoleCode());
        vo.setDataScope(r.getDataScope());
        vo.setBuiltin(r.getBuiltin() != null && r.getBuiltin() == 1);
        vo.setSortOrder(r.getSortOrder());
        vo.setStatus(r.getStatus());
        vo.setRemark(r.getRemark());
        vo.setCreatedAt(r.getCreatedAt());
        return vo;
    }
}
