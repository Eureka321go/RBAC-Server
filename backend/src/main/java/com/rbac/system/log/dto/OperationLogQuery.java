package com.rbac.system.log.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class OperationLogQuery extends PageRequest {

    private String title;
    private String operator;
    private String status;
}
