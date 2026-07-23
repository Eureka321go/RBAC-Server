package com.rbac.im.vo;

import lombok.Data;

@Data
public class ImGroupVO {
    private Long groupId;
    private String name;
    private Long ownerId;
    private Integer memberCount;
    private String myRole;
}
