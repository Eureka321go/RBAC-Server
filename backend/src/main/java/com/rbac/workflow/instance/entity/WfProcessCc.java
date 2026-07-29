package com.rbac.workflow.instance.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 抄送：无需审批、仅知会的接收人。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("wf_process_cc")
public class WfProcessCc extends BaseEntity {

    private Long instanceId;
    private Long userId;
    /** 是否已读 0/1 */
    private Integer readFlag;
}
