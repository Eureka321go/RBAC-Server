package com.rbac.system.log.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class LoginLogQuery extends PageRequest {

    private String username;
    private String status;
}
