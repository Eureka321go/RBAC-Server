package com.rbac.workflow.definition.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 流程定义：一类审批的模板，如「请假审批」。
 * process_key + version 唯一，运行中实例锁定其发起时的版本。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("wf_process_definition")
public class WfProcessDefinition extends BaseEntity {

    private String processKey;
    private String name;
    private String category;
    private String formKey;
    private Integer version;
    private String status;
    private String remark;
}
