package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
public class InboundMessageConsumer {

    private final ImMessageRepository repo;
    private final MessageAppender appender;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundMessageConsumer(ImMessageRepository repo, MessageAppender appender) {
        this.repo = repo;
        this.appender = appender;
    }

    @KafkaListener(topics = ImKafkaTopics.IN, groupId = "im-logic")
    public void onMessage(String json) throws Exception {
        Envelope env = mapper.readValue(json, Envelope.class);

        // 幂等：同一发送者 + clientMsgId 只处理一次
        if (env.getClientMsgId() != null
                && repo.existsBySenderIdAndClientMsgId(env.getSenderId(), env.getClientMsgId())) {
            return;
        }

        appender.append(env.getCid(), env.getSenderId(), env.getType(), env.getBody(), env.getClientMsgId());
    }
}
