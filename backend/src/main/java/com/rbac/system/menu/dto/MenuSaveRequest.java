package com.rbac.system.menu.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class MenuSaveRequest {

    private Long parentId;

    @Pattern(regexp = "DIR|MENU|BUTTON", message = "菜单类型非法")
    @NotBlank(message = "菜单类型不能为空")
    private String menuType;

    @NotBlank(message = "菜单名称不能为空")
    private String menuName;

    private String path;
    private String component;
    private String permissionCode;
    private String icon;
    private Integer sortOrder;
    private Boolean visible;
    private Boolean keepAlive;
    private String externalLink;

    @Pattern(regexp = "ENABLED|DISABLED", message = "状态取值非法")
    private String status;
}
