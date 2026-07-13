package com.rbac.workflow.task.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/**
 * 审批记录：每次审批动作（提交/同意/驳回/转办/加签/撤回）的留痕，用于时间线展示与审计。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("wf_process_record")
public class WfProcessRecord extends BaseEntity {

    private Long instanceId;
    private Integer nodeOrder;
    private Long operatorId;
    /** SUBMIT / APPROVE / REJECT / TRANSFER / ADD_SIGN / WITHDRAW */
    private String action;
    /** 审批意见（限长 500，同操作日志红线） */
    private String comment;
    private LocalDateTime operateTime;
}
