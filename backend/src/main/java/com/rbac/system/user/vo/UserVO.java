package com.rbac.system.user.vo;

import com.rbac.system.user.entity.SysUser;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
public class UserVO {

    private Long id;
    private Long deptId;
    private String deptName;
    private String username;
    private String nickname;
    private String email;
    private String phone;
    private String gender;
    private String status;
    private String remark;
    private LocalDateTime lastLoginAt;
    private LocalDateTime createdAt;
    private List<Long> roleIds = new ArrayList<>();
    private List<String> roleNames = new ArrayList<>();

    public static UserVO from(SysUser u) {
        UserVO vo = new UserVO();
        vo.setId(u.getId());
        vo.setDeptId(u.getDeptId());
        vo.setUsername(u.getUsername());
        vo.setNickname(u.getNickname());
        vo.setEmail(u.getEmail());
        vo.setPhone(u.getPhone());
        vo.setGender(u.getGender());
        vo.setStatus(u.getStatus());
        vo.setRemark(u.getRemark());
        vo.setLastLoginAt(u.getLastLoginAt());
        vo.setCreatedAt(u.getCreatedAt());
        return vo;
    }
}
