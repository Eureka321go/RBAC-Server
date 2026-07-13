package com.rbac.workflow.definition.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class DefinitionQuery extends PageRequest {

    private String processKey;
    private String name;
    private String category;
    private String status;
}
