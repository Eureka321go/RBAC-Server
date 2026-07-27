package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.protocol.Envelope;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

/** 统一消息写入：定序 + 落库 + 更新会话摘要 + 扇出。用户消息与 SYSTEM 消息共用。 */
@Service
public class MessageAppender {

    private final ImMessageRepository repo;
    private final SeqService seqService;
    private final OutboundDispatcher dispatcher;
    private final ImConversationMapper conversationMapper;
    private final MediaUrlEnricher enricher;

    public MessageAppender(ImMessageRepository repo,
                           SeqService seqService,
                           OutboundDispatcher dispatcher,
                           ImConversationMapper conversationMapper,
                           MediaUrlEnricher enricher) {
        this.repo = repo;
        this.seqService = seqService;
        this.dispatcher = dispatcher;
        this.conversationMapper = conversationMapper;
        this.enricher = enricher;
    }

    /** 追加一条消息并扇出，返回定序后的 seq。 */
    public long append(String cid, Long senderId, String type, Map<String, Object> body, String clientMsgId) {
        long seq = seqService.nextSeq(cid);
        String msgId = UUID.randomUUID().toString().replace("-", "");
        long ts = System.currentTimeMillis();

        ImMessage m = new ImMessage();
        m.setCid(cid);
        m.setSeq(seq);
        m.setMsgId(msgId);
        m.setSenderId(senderId);
        m.setType(type);
        m.setBody(body);
        m.setClientMsgId(clientMsgId);
        m.setTs(ts);
        repo.save(m);

        updateSummary(cid, seq, preview(type, body));

        Envelope push = new Envelope();
        push.setOp("PUSH");
        push.setCid(cid);
        push.setSenderId(senderId);
        push.setType(type);
        push.setBody(enricher.enrich(type, body));
        push.setClientMsgId(clientMsgId);
        push.setSeq(seq);
        push.setMsgId(msgId);
        push.setTs(ts);
        dispatcher.dispatch(cid, push);

        return seq;
    }

    private void updateSummary(String cid, long seq, String preview) {
        ImConversation c = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        if (c != null) {
            c.setLastMsgSeq(seq);
            c.setLastMsgPreview(preview);
            conversationMapper.updateById(c);
        }
    }

    /** 会话列表用的摘要文案。 */
    static String preview(String type, Map<String, Object> body) {
        if ("TEXT".equals(type) && body != null && body.get("text") != null) {
            String t = String.valueOf(body.get("text"));
            return t.length() > 200 ? t.substring(0, 200) : t;
        }
        if ("SYSTEM".equals(type)) {
            return "[系统消息]";
        }
        if ("RECALL".equals(type)) {
            return "[撤回了一条消息]";
        }
        return "[" + type + "]";
    }
}
