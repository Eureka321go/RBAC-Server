package com.rbac.workflow.definition.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

import java.util.List;

/**
 * 新增/编辑流程定义（含节点）。编辑时 id 非空，服务端据此生成新版本。
 */
@Data
public class DefinitionSaveRequest {

    /** 编辑时携带原定义 id；新增时为空 */
    private Long id;

    @NotBlank(message = "{valid.workflow.def.processKey.notBlank}")
    @Pattern(regexp = "[a-zA-Z][a-zA-Z0-9_]*", message = "{valid.workflow.def.processKey.pattern}")
    private String processKey;

    @NotBlank(message = "{valid.workflow.def.name.notBlank}")
    private String name;

    private String category;

    private String formKey;

    @Pattern(regexp = "ENABLED|DISABLED", message = "{valid.status.pattern}")
    private String status;

    private String remark;

    @Valid
    @NotEmpty(message = "{valid.workflow.def.nodes.notEmpty}")
    private List<NodeSaveRequest> nodes;
}
