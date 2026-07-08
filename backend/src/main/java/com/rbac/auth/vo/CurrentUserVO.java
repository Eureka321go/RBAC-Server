package com.rbac.auth.vo;

import lombok.Data;

import java.util.List;

@Data
public class CurrentUserVO {

    private Long id;
    private String username;
    private String nickname;
    private String avatar;
    private Long deptId;
    private String deptName;
    private List<RoleBriefVO> roles;

    @Data
    public static class RoleBriefVO {
        private Long roleId;
        private String roleCode;
        private String roleName;

        public RoleBriefVO(Long roleId, String roleCode, String roleName) {
            this.roleId = roleId;
            this.roleCode = roleCode;
            this.roleName = roleName;
        }
    }
}
