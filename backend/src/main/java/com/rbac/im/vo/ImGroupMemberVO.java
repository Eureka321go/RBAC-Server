package com.rbac.im.vo;

import lombok.Data;

@Data
public class ImGroupMemberVO {
    private Long userId;
    private String displayName;
    private String role;
    private boolean muted;
}
