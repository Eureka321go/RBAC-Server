package com.rbac.system.role.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("sys_role")
public class SysRole extends BaseEntity {

    private String roleName;
    private String roleCode;
    private String dataScope;
    private Integer builtin;
    private Integer sortOrder;
    private String status;
    private String remark;
}
