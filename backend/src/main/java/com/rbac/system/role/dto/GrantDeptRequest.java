package com.rbac.system.role.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class GrantDeptRequest {

    private List<Long> deptIds = new ArrayList<>();
}
