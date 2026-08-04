package com.rbac.im.push.delivery;

import com.rbac.im.push.candidate.PushCandidate;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class FcmPayloadFactory {

    public Map<String, String> create(PushCandidate candidate,
                                      PushTarget target,
                                      PushPresentation presentation) {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("version", "1");
        data.put("event", "NEW_MESSAGE");
        data.put("recipientUserId", Long.toString(target.recipientUserId()));
        data.put("msgId", candidate.msgId());
        data.put("cid", candidate.cid());
        data.put("seq", Long.toString(candidate.seq()));
        data.put("conversationType", candidate.cid().startsWith("g_") ? "GROUP" : "SINGLE");
        data.put("groupId", candidate.cid().startsWith("g_") ? candidate.cid().substring(2) : "");
        data.put("title", presentation.title());
        data.put("senderName", presentation.senderName());
        data.put("preview", candidate.preview());
        data.put("mentioned", Boolean.toString(target.mentioned()));
        data.put("ts", Long.toString(candidate.ts()));
        return Map.copyOf(data);
    }
}
