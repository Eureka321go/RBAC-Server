package com.rbac.system.dict.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class DictTypeQuery extends PageRequest {

    private String dictName;
    private String dictCode;
    private String status;
}
