package com.rbac.workflow.task.dto;

import com.rbac.common.domain.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class TaskQuery extends PageRequest {

    /** 按单据标题模糊过滤（可空） */
    private String title;
}
