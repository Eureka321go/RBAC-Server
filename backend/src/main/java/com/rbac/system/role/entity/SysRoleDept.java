package com.rbac.system.role.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/**
 * 角色自定义数据范围部门。仅在角色 data_scope = CUSTOM_DEPT 时有效。
 */
@Data
@TableName("sys_role_dept")
public class SysRoleDept {

    private Long id;
    private Long roleId;
    private Long deptId;
    private Integer includeChildren;
}
