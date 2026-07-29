package com.rbac.workflow.instance.vo;

import com.rbac.workflow.instance.entity.WfProcessCc;
import com.rbac.workflow.instance.entity.WfProcessInstance;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 抄送我的列表项。
 */
@Data
public class CcVO {

    private Long id;
    private Long instanceId;
    private String title;
    private String processKey;
    private Long initiatorId;
    private String initiatorName;
    private String instanceStatus;
    private Integer readFlag;
    private LocalDateTime createdAt;

    public static CcVO from(WfProcessCc cc, WfProcessInstance inst, String initiatorName) {
        CcVO vo = new CcVO();
        vo.setId(cc.getId());
        vo.setInstanceId(cc.getInstanceId());
        vo.setReadFlag(cc.getReadFlag());
        vo.setCreatedAt(cc.getCreatedAt());
        if (inst != null) {
            vo.setTitle(inst.getTitle());
            vo.setProcessKey(inst.getProcessKey());
            vo.setInitiatorId(inst.getInitiatorId());
            vo.setInstanceStatus(inst.getInstanceStatus());
        }
        vo.setInitiatorName(initiatorName);
        return vo;
    }
}
