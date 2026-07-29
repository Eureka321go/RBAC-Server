package com.rbac.workflow.task.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 审批意见（同意/驳回通用）。意见限长 500，符合日志红线。
 */
@Data
public class CommentRequest {

    @Size(max = 500, message = "{valid.workflow.comment.size}")
    private String comment;
}
