package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class InboundMessageConsumer {

    private static final Logger log = LoggerFactory.getLogger(InboundMessageConsumer.class);

    private final ImMessageRepository repo;
    private final MessageAppender appender;
    private final ConversationService conversationService;
    private final OutboundDispatcher dispatcher;
    private final MediaService mediaService;
    private final LinkPreviewService linkPreview;
    private final RecallService recallService;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundMessageConsumer(ImMessageRepository repo,
                                  MessageAppender appender,
                                  ConversationService conversationService,
                                  OutboundDispatcher dispatcher,
                                  MediaService mediaService,
                                  LinkPreviewService linkPreview,
                                  RecallService recallService) {
        this.repo = repo;
        this.appender = appender;
        this.conversationService = conversationService;
        this.dispatcher = dispatcher;
        this.mediaService = mediaService;
        this.linkPreview = linkPreview;
        this.recallService = recallService;
    }

    @KafkaListener(topics = ImKafkaTopics.IN, groupId = "im-logic")
    public void onMessage(String json) throws Exception {
        Envelope env = mapper.readValue(json, Envelope.class);

        // 里程碑8：撤回走独立编排（自带成员/权限/时间窗校验）
        if ("RECALL".equals(env.getOp())) {
            recallService.recall(env);
            return;
        }

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

        // 富媒体校验：objectKey 归属 + HEAD 确认 + 大小/mime 复核 + 回填 size/mime
        if (MediaService.isMedia(env.getType())) {
            try {
                mediaService.validateForSend(env.getCid(), env.getType(), env.getBody());
            } catch (MediaValidationException ex) {   // 具体在前：它也是 RuntimeException
                pushError(env, ex.getReason());
                return;
            } catch (RuntimeException ex) {
                // 对象存储故障/超时若逃出本方法，Kafka 重试后会静默丢弃这条消息，
                // 发送方收了 ACK 却永远等不到 PUSH/ERROR。这里兜住并回通用码。
                log.warn("媒体校验时对象存储不可用 cid={} senderId={}: {}",
                        env.getCid(), env.getSenderId(), ex.toString());
                pushError(env, "STORAGE_UNAVAILABLE");   // 只回通用码，不外泄 SDK 异常细节
                return;
            }
        }

        long seq = appender.append(env.getCid(), env.getSenderId(), env.getType(), env.getBody(), env.getClientMsgId());

        // 里程碑7：TEXT 消息异步补链接卡片（不阻塞消费线程；无 URL / 失败自然降级纯文本）
        if ("TEXT".equals(env.getType()) && env.getBody() != null
                && env.getBody().get("text") instanceof String text) {
            linkPreview.tryEnrich(env.getCid(), seq, text);
        }
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
