package com.rbac.im.push.candidate;

import java.util.List;

public record PushCandidate(
        int version,
        String msgId,
        String cid,
        long seq,
        long senderId,
        String type,
        String preview,
        List<Long> mentionTargetIds,
        long ts) {
}
