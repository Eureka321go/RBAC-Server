package com.rbac.workflow.instance.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class InstanceQuery extends PageRequest {

    private String processKey;
    private String title;
    private String instanceStatus;
}