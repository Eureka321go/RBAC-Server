package com.rbac.workflow.definition.vo;

import com.rbac.workflow.definition.entity.WfProcessNode;
import lombok.Data;

@Data
public class NodeVO {

    private Long id;
    private Integer nodeOrder;
    private String nodeName;
    private String assigneeType;
    private String assigneeValue;
    private String approveMode;
    private String rejectStrategy;
    private String conditionExpr;

    public static NodeVO from(WfProcessNode n) {
        NodeVO vo = new NodeVO();
        vo.setId(n.getId());
        vo.setNodeOrder(n.getNodeOrder());
        vo.setNodeName(n.getNodeName());
        vo.setAssigneeType(n.getAssigneeType());
        vo.setAssigneeValue(n.getAssigneeValue());
        vo.setApproveMode(n.getApproveMode());
        vo.setRejectStrategy(n.getRejectStrategy());
        vo.setConditionExpr(n.getConditionExpr());
        return vo;
    }
}
