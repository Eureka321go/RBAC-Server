package com.rbac.im.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("im_conversation")
public class ImConversation extends BaseEntity {
    private String cid;
    private String type;          // SINGLE / GROUP
    private Long groupId;
    private Long lastMsgSeq;
    private String lastMsgPreview;
    private Long lastMsgTs;
}
