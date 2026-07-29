package com.rbac.im.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;

/** 创建单聊请求。 */
@Data
public class CreateSingleConversationRequest {

    @NotNull
    @Positive
    private Long peerId;
}
