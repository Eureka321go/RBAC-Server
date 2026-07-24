package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class InboundMessageConsumer {

    private final ImMessageRepository repo;
    private final MessageAppender appender;
    private final ConversationService conversationService;
    private final OutboundDispatcher dispatcher;
    private final MediaService mediaService;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundMessageConsumer(ImMessageRepository repo,
                                  MessageAppender appender,
                                  ConversationService conversationService,
                                  OutboundDispatcher dispatcher,
                                  MediaService mediaService) {
        this.repo = repo;
        this.appender = appender;
        this.conversationService = conversationService;
        this.dispatcher = dispatcher;
        this.mediaService = mediaService;
    }

    @KafkaListener(topics = ImKafkaTopics.IN, groupId = "im-logic")
    public void onMessage(String json) throws Exception {
        Envelope env = mapper.readValue(json, Envelope.class);

        // 幂等：同一发送者 + clientMsgId 只处理一次
        if (env.getClientMsgId() != null
                && repo.existsBySenderIdAndClientMsgId(env.getSenderId(), env.getClientMsgId())) {
            return;
        }

        // 成员校验（安全红线）：非成员 / 被禁言 → 丢弃并回 ERROR
        if (!conversationService.isMember(env.getCid(), env.getSenderId())) {
            pushError(env, "NOT_MEMBER");
            return;
        }
        if (conversationService.isGroupMuted(env.getCid(), env.getSenderId())) {
            pushError(env, "MUTED");
            return;
        }

        // 富媒体校验：objectKey 归属 + HEAD 确认 + 回填 size/mime
        if (MediaService.isMedia(env.getType())) {
            try {
                mediaService.validateForSend(env.getCid(), env.getBody());
            } catch (MediaValidationException ex) {
                pushError(env, ex.getReason());
                return;
            }
        }

        appender.append(env.getCid(), env.getSenderId(), env.getType(), env.getBody(), env.getClientMsgId());
    }

    private void pushError(Envelope src, String reason) {
        Envelope err = new Envelope();
        err.setOp("ERROR");
        err.setCid(src.getCid());
        err.setSenderId(src.getSenderId());
        err.setClientMsgId(src.getClientMsgId());
        err.setBody(Map.of("reason", reason));
        dispatcher.dispatchToUser(src.getSenderId(), err);
    }
}
