package com.rbac.workflow.support;

import com.rbac.system.user.entity.SysUser;
import lombok.Data;

/** 审批人选择器使用的最小公开用户字段。 */
@Data
public class AssigneeUserOptionVO {

    private Long id;
    private String username;
    private String nickname;
    private String deptName;

    public static AssigneeUserOptionVO from(SysUser user, String deptName) {
        AssigneeUserOptionVO option = new AssigneeUserOptionVO();
        option.setId(user.getId());
        option.setUsername(user.getUsername());
        option.setNickname(user.getNickname());
        option.setDeptName(deptName);
        return option;
    }
}
