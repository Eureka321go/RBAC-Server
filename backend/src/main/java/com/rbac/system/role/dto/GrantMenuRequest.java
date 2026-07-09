package com.rbac.system.role.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class GrantMenuRequest {

    private List<Long> menuIds = new ArrayList<>();
}
