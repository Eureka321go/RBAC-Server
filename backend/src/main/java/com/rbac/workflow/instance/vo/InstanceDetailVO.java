package com.rbac.workflow.instance.vo;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 流程实例详情：实例概要 + 表单快照 + 审批时间线 + 任务列表。
 */
@Data
public class InstanceDetailVO {

    private Long id;
    private String processKey;
    private String title;
    private String businessKey;
    private String instanceStatus;
    private Integer currentNodeOrder;
    private Long initiatorId;
    private String initiatorName;
    private LocalDateTime submitTime;
    private LocalDateTime endTime;
    /** 表单快照（已反序列化为对象/键值） */
    private Object formData;
    private List<RecordVO> records;
    private List<TaskBrief> tasks;

    /** 任务简要（含审批人名），用于详情展示各节点处理情况。 */
    @Data
    public static class TaskBrief {
        private Long id;
        private Integer nodeOrder;
        private String nodeName;
        private Long assigneeId;
        private String assigneeName;
        private String taskStatus;
        private LocalDateTime approveTime;
    }
}
