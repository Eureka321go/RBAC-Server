package com.rbac.im.vo;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class ImContactDepartmentVO {
    private Long id;
    private Long parentId;
    private String name;
    private Integer sortOrder;
}
