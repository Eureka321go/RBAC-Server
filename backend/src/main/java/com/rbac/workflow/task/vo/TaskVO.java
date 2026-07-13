package com.rbac.workflow.task.vo;

import com.rbac.workflow.instance.entity.WfProcessInstance;
import com.rbac.workflow.task.entity.WfProcessTask;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 待办/已办列表项：任务字段 + 冗余的实例概要，便于前端直接展示。
 */
@Data
public class TaskVO {

    private Long id;
    private Long instanceId;
    private String nodeName;
    private String taskStatus;
    private LocalDateTime approveTime;
    private LocalDateTime createdAt;
    // 实例概要
    private String title;
    private String processKey;
    private Long initiatorId;
    private String initiatorName;

    public static TaskVO from(WfProcessTask t, WfProcessInstance inst, String initiatorName) {
        TaskVO vo = new TaskVO();
        vo.setId(t.getId());
        vo.setInstanceId(t.getInstanceId());
        vo.setNodeName(t.getNodeName());
        vo.setTaskStatus(t.getTaskStatus());
        vo.setApproveTime(t.getApproveTime());
        vo.setCreatedAt(t.getCreatedAt());
        if (inst != null) {
            vo.setTitle(inst.getTitle());
            vo.setProcessKey(inst.getProcessKey());
            vo.setInitiatorId(inst.getInitiatorId());
        }
        vo.setInitiatorName(initiatorName);
        return vo;
    }
}
