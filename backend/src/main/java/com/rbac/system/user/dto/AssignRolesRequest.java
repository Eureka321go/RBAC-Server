package com.rbac.system.user.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class AssignRolesRequest {

    private List<Long> roleIds = new ArrayList<>();
}
