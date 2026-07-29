package com.rbac.workflow.instance.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.Version;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/**
 * 流程实例：一次具体发起，绑定发起人、业务数据、当前节点、状态。
 * version 为乐观锁，防止会签并发重复推进节点。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("wf_process_instance")
public class WfProcessInstance extends BaseEntity {

    private Long definitionId;
    private String processKey;
    private String businessKey;
    private String title;
    private Long initiatorId;
    private Long initiatorDeptId;
    private Integer currentNodeOrder;
    /** DRAFT / RUNNING / APPROVED / REJECTED / CANCELED */
    private String instanceStatus;
    /** 表单快照（原始 JSON 字符串） */
    private String formData;
    private LocalDateTime submitTime;
    private LocalDateTime endTime;

    @Version
    private Integer version;
}
