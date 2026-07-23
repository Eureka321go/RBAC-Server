package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class InboundMessageConsumer {

    private final ImMessageRepository repo;
    private final SeqService seqService;
    private final ConversationService conversationService;
    private final OutboundDispatcher dispatcher;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundMessageConsumer(ImMessageRepository repo,
                                  SeqService seqService,
                                  ConversationService conversationService,
                                  OutboundDispatcher dispatcher) {
        this.repo = repo;
        this.seqService = seqService;
        this.conversationService = conversationService;
        this.dispatcher = dispatcher;
    }

    @KafkaListener(topics = ImKafkaTopics.IN, groupId = "im-logic")
    public void onMessage(String json) throws Exception {
        Envelope env = mapper.readValue(json, Envelope.class);

        // 幂等：同一发送者 + clientMsgId 只处理一次
        if (env.getClientMsgId() != null
                && repo.existsBySenderIdAndClientMsgId(env.getSenderId(), env.getClientMsgId())) {
            return;
        }

        long seq = seqService.nextSeq(env.getCid());
        String msgId = UUID.randomUUID().toString().replace("-", "");
        long ts = System.currentTimeMillis();

        ImMessage m = new ImMessage();
        m.setCid(env.getCid());
        m.setSeq(seq);
        m.setMsgId(msgId);
        m.setSenderId(env.getSenderId());
        m.setType(env.getType());
        m.setBody(env.getBody());
        m.setClientMsgId(env.getClientMsgId());
        m.setTs(ts);
        repo.save(m);

        // 组装下行 PUSH 信封
        Envelope push = new Envelope();
        push.setOp("PUSH");
        push.setCid(env.getCid());
        push.setSenderId(env.getSenderId());
        push.setType(env.getType());
        push.setBody(env.getBody());
        push.setClientMsgId(env.getClientMsgId());
        push.setSeq(seq);
        push.setMsgId(msgId);
        push.setTs(ts);

        dispatcher.dispatch(env.getCid(), push);
    }
}
