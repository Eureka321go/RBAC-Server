package com.rbac.im.protocol;

import lombok.Data;
import java.util.Map;

/** 网关与 logic 之间、以及推给客户端的统一消息信封（JSON）。 */
@Data
public class Envelope {
    private String op;          // SEND / PUSH / ACK
    private String cid;
    private Long senderId;
    private String deviceId;
    private String clientMsgId;
    private String type;        // TEXT
    private Map<String, Object> body;
    private Long seq;           // 定序后回填
    private String msgId;
    private Long ts;
}
