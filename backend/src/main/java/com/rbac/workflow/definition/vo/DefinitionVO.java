package com.rbac.workflow.definition.vo;

import com.rbac.workflow.definition.entity.WfProcessDefinition;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

@Data
public class DefinitionVO {

    private Long id;
    private String processKey;
    private String name;
    private String category;
    private String formKey;
    private Integer version;
    private String status;
    private String remark;
    private LocalDateTime createdAt;
    /** 仅详情接口返回节点列表 */
    private List<NodeVO> nodes;

    public static DefinitionVO from(WfProcessDefinition d) {
        DefinitionVO vo = new DefinitionVO();
        vo.setId(d.getId());
        vo.setProcessKey(d.getProcessKey());
        vo.setName(d.getName());
        vo.setCategory(d.getCategory());
        vo.setFormKey(d.getFormKey());
        vo.setVersion(d.getVersion());
        vo.setStatus(d.getStatus());
        vo.setRemark(d.getRemark());
        vo.setCreatedAt(d.getCreatedAt());
        return vo;
    }
}
