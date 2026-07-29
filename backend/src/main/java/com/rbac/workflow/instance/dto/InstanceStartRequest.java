package com.rbac.workflow.instance.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.Map;

/**
 * 发起审批请求。表单数据与流程解耦，通过 businessKey 关联业务单据，formData 作为快照留痕。
 */
@Data
public class InstanceStartRequest {

    @NotBlank(message = "{valid.workflow.start.processKey.notBlank}")
    private String processKey;

    /** 业务单据 ID（可空） */
    private String businessKey;

    @NotBlank(message = "{valid.workflow.start.title.notBlank}")
    private String title;

    /** 表单数据快照（可空） */
    private Map<String, Object> formData;
}
