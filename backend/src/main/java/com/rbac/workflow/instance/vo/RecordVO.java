package com.rbac.workflow.instance.vo;

import com.rbac.workflow.task.entity.WfProcessRecord;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 审批记录（时间线项）。
 */
@Data
public class RecordVO {

    private Long id;
    private Integer nodeOrder;
    private Long operatorId;
    private String operatorName;
    private String action;
    private String comment;
    private LocalDateTime operateTime;

    public static RecordVO from(WfProcessRecord r, String operatorName) {
        RecordVO vo = new RecordVO();
        vo.setId(r.getId());
        vo.setNodeOrder(r.getNodeOrder());
        vo.setOperatorId(r.getOperatorId());
        vo.setOperatorName(operatorName);
        vo.setAction(r.getAction());
        vo.setComment(r.getComment());
        vo.setOperateTime(r.getOperateTime());
        return vo;
    }
}
