package com.rbac.workflow.task.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/**
 * 审批任务：分派给某审批人的待办，一个节点可产生多条（会签）。
 * 索引 (assignee_id, task_status) 支撑「我的待办」高频查询。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("wf_process_task")
public class WfProcessTask extends BaseEntity {

    private Long instanceId;
    private Integer nodeOrder;
    private String nodeName;
    private Long assigneeId;
    /** PENDING / APPROVED / REJECTED / TRANSFERRED / CANCELED */
    private String taskStatus;
    private LocalDateTime approveTime;
}
