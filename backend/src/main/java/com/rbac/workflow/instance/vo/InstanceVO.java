package com.rbac.workflow.instance.vo;

import com.rbac.workflow.instance.entity.WfProcessInstance;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 流程实例列表项（我发起的）。
 */
@Data
public class InstanceVO {

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

    public static InstanceVO from(WfProcessInstance i, String initiatorName) {
        InstanceVO vo = new InstanceVO();
        vo.setId(i.getId());
        vo.setProcessKey(i.getProcessKey());
        vo.setTitle(i.getTitle());
        vo.setBusinessKey(i.getBusinessKey());
        vo.setInstanceStatus(i.getInstanceStatus());
        vo.setCurrentNodeOrder(i.getCurrentNodeOrder());
        vo.setInitiatorId(i.getInitiatorId());
        vo.setInitiatorName(initiatorName);
        vo.setSubmitTime(i.getSubmitTime());
        vo.setEndTime(i.getEndTime());
        return vo;
    }
}
