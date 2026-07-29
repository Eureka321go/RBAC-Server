package com.rbac.im.vo;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class ImContactMemberVO {
    private Long userId;
    private Long deptId;
    private String username;
    private String displayName;
    private String avatar;
}
