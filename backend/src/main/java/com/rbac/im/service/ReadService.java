package com.rbac.im.service;

import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 里程碑10：已读上报。op=READ 帧不落库、不占 seq。
 * 校验成员 → 钳制到 last_msg_seq → 前向单调推进 last_read_seq；
 * 仅单聊且确实推进时向对端（排除阅读者）扇出 op=READ 回执。群聊只推进不扇出。
 */
@Service
public class ReadService {

    private final ConversationService conversationService;
    private final ImConversationMemberMapper memberMapper;
    private final OutboundDispatcher dispatcher;

    public ReadService(ConversationService conversationService,
                       ImConversationMemberMapper memberMapper,
                       OutboundDispatcher dispatcher) {
        this.conversationService = conversationService;
        this.memberMapper = memberMapper;
        this.dispatcher = dispatcher;
    }

    public void read(Envelope env) {
        String cid = env.getCid();
        long readerId = env.getSenderId();

        // 1) 成员校验：被动阅读，非成员静默返回（不回 ERROR）
        if (!conversationService.isMember(cid, readerId)) {
            return;
        }

        // 2) 解析 readSeq：缺失/非数字 → no-op
        Object raw = env.getBody() == null ? null : env.getBody().get("readSeq");
        if (!(raw instanceof Number n)) {
            return;
        }

        // 3) 钳制到会话 last_msg_seq，防止上报超大 seq 把未来消息永久标记已读
        long effective = Math.min(n.longValue(), conversationService.lastMsgSeq(cid));

        // 4) 前向单调推进
        int rows = memberMapper.advanceReadSeq(cid, readerId, effective);
        if (rows == 0) {
            return; // 未推进（重复/过期上报）→ 不扇出
        }

        // 5) 仅单聊扇出回执给对端（排除阅读者）
        if (ConversationService.groupIdFromCid(cid) != null) {
            return; // 群聊只推进不扇出
        }
        Envelope receipt = new Envelope();
        receipt.setOp("READ");
        receipt.setCid(cid);
        receipt.setSenderId(readerId);
        receipt.setBody(Map.of("readSeq", effective));
        for (Long uid : conversationService.memberUserIds(cid)) {
            if (uid != readerId) {
                dispatcher.dispatchToUser(uid, receipt);
            }
        }
    }
}
