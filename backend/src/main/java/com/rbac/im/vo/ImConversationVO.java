package com.rbac.im.vo;

import lombok.Data;

/** 会话列表同步项。 */
@Data
public class ImConversationVO {
    private String cid;
    private String type;            // SINGLE / GROUP
    private Long groupId;
    private Long peerId;            // 单聊对端用户 ID；群聊为 null
    private String peerName;        // 单聊对端昵称，昵称为空时回退用户名
    private Long lastMsgSeq;
    private String lastMsgPreview;
    private Long lastMsgTs;
    private Long lastReadSeq;
    private Long unreadCount;
    private Long mentionSeq;        // 我被 @ 命中的最新消息 seq（里程碑9）
    private boolean hasMention;     // mentionSeq > lastReadSeq → "有人@我"强提醒
    private boolean muted;           // 当前用户是否为此会话开启消息免打扰
    private Long peerReadSeq;        // 里程碑10：单聊对端已读位点；群聊/无对端为 null
}
