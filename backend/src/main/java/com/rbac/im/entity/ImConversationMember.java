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
    private Long lastReadSeq; // 我在这个会话里读到第几条（已读水位）
    private Long mentionSeq; // 最近一次 @我 的消息序号
    private Integer muted; // 是否免打扰
}
