package com.rbac.im.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class SetConversationMuteRequest {
    @NotNull
    private Boolean muted;
}
