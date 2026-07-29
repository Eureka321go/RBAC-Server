package com.rbac.workflow.definition.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

/**
 * 流程节点配置项（表单式，非拖拽）。
 */
@Data
public class NodeSaveRequest {

    @NotNull(message = "{valid.workflow.node.order.notNull}")
    private Integer nodeOrder;

    @NotBlank(message = "{valid.workflow.node.name.notBlank}")
    private String nodeName;

    @NotBlank(message = "{valid.workflow.node.assigneeType.notBlank}")
    @Pattern(regexp = "USER|ROLE|POST|DEPT_LEADER|INITIATOR_SELF|INITIATOR_LEADER",
            message = "{valid.workflow.node.assigneeType.pattern}")
    private String assigneeType;

    /** USER/ROLE/POST 时必填（id，逗号分隔）；DEPT_LEADER/INITIATOR_* 可空 */
    private String assigneeValue;

    @Pattern(regexp = "ANY|ALL|SEQUENTIAL", message = "{valid.workflow.node.approveMode.pattern}")
    private String approveMode;

    @Pattern(regexp = "TO_INITIATOR|TO_PREV", message = "{valid.workflow.node.rejectStrategy.pattern}")
    private String rejectStrategy;

    /** 分支条件（如 amount > 5000），空则必经 */
    private String conditionExpr;
}
