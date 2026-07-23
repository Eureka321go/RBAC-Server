package com.rbac.im.vo;

import lombok.Data;

/** 会话列表同步项。 */
@Data
public class ImConversationVO {
    private String cid;
    private String type;            // SINGLE / GROUP
    private Long groupId;
    private Long lastMsgSeq;
    private String lastMsgPreview;
    private Long lastReadSeq;
    private Long unreadCount;
}
