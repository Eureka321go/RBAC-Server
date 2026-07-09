package com.rbac.system.menu.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class MenuSaveRequest {

    private Long parentId;

    @Pattern(regexp = "DIR|MENU|BUTTON", message = "{valid.menu.type.pattern}")
    @NotBlank(message = "{valid.menu.type.notBlank}")
    private String menuType;

    @NotBlank(message = "{valid.menu.name.notBlank}")
    private String menuName;

    private String path;
    private String component;
    private String permissionCode;
    private String icon;
    private Integer sortOrder;
    private Boolean visible;
    private Boolean keepAlive;
    private String externalLink;

    @Pattern(regexp = "ENABLED|DISABLED", message = "{valid.status.pattern}")
    private String status;
}
