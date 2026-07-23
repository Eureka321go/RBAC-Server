package com.rbac.im.doc;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.Map;

@Data
@Document("im_message")
@CompoundIndex(name = "cid_seq", def = "{'cid': 1, 'seq': 1}", unique = true)
public class ImMessage {
    @Id
    private String id;
    private String cid;
    private Long seq;
    private String msgId;
    private Long senderId;
    private String type;            // TEXT（本阶段）
    private Map<String, Object> body;
    private boolean recalled;
    @Indexed
    private String clientMsgId;
    private Long ts;                // epoch millis
}
