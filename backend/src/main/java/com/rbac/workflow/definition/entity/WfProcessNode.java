package com.rbac.workflow.definition.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 流程节点：定义中的单个审批环节，指定审批人来源与会签策略。
 * node_order 从 1 递增，引擎按序流转。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("wf_process_node")
public class WfProcessNode extends BaseEntity {

    private Long definitionId;
    private Integer nodeOrder;
    private String nodeName;
    /** USER / ROLE / POST / DEPT_LEADER / INITIATOR_SELF / INITIATOR_LEADER */
    private String assigneeType;
    /** 来源取值（用户/角色/岗位 id，多个逗号分隔），部分类型可为空 */
    private String assigneeValue;
    /** ANY / ALL / SEQUENTIAL */
    private String approveMode;
    /** TO_INITIATOR / TO_PREV */
    private String rejectStrategy;
    /** 分支条件（如 amount > 5000），空则必经 */
    private String conditionExpr;
}
