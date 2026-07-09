package com.rbac.system.post.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class PostQuery extends PageRequest {

    private String postName;
    private String postCode;
    private String status;
}
