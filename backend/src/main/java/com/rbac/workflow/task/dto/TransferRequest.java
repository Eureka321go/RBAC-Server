package com.rbac.workflow.task.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 转办请求。
 */
@Data
public class TransferRequest {

    @NotNull(message = "{valid.workflow.transfer.target.notNull}")
    private Long targetUserId;

    @Size(max = 500, message = "{valid.workflow.comment.size}")
    private String comment;
}
