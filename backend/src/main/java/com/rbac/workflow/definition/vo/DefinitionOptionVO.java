package com.rbac.workflow.definition.vo;

import com.rbac.workflow.definition.entity.WfProcessDefinition;
import lombok.Data;

/** 已启用流程定义的最小选项数据，供普通用户发起审批。 */
@Data
public class DefinitionOptionVO {

    private String processKey;
    private String name;
    private String category;
    private String formKey;
    private Integer version;

    public static DefinitionOptionVO from(WfProcessDefinition definition) {
        DefinitionOptionVO option = new DefinitionOptionVO();
        option.setProcessKey(definition.getProcessKey());
        option.setName(definition.getName());
        option.setCategory(definition.getCategory());
        option.setFormKey(definition.getFormKey());
        option.setVersion(definition.getVersion());
        return option;
    }
}
