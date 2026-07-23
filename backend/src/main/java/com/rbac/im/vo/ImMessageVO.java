package com.rbac.im.vo;

import lombok.Data;

import java.util.Map;

/** 下发给客户端的消息项（不含 clientMsgId）。 */
@Data
public class ImMessageVO {
    private String cid;
    private Long seq;
    private String msgId;
    private Long senderId;
    private String type;
    private Map<String, Object> body;
    private boolean recalled;
    private Long ts;
}
