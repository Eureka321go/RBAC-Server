package com.rbac.im.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("im_conversation_member")
public class ImConversationMember extends BaseEntity {
    private String cid;
    private Long userId;
    private Long lastReadSeq;
    private Long mentionSeq;
    private Integer muted;
}
