package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.List;
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
    private final MentionService mentionService;
    private final ReadService readService;
    private final QuoteService quoteService;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundMessageConsumer(ImMessageRepository repo,
                                  MessageAppender appender,
                                  ConversationService conversationService,
                                  OutboundDispatcher dispatcher,
                                  MediaService mediaService,
                                  LinkPreviewService linkPreview,
                                  RecallService recallService,
                                  MentionService mentionService,
                                  ReadService readService,
                                  QuoteService quoteService) {
        this.repo = repo;                                // SEND 前置：按 clientMsgId 做幂等校验
        this.appender = appender;                        // SEND 主流程：定序、落库、更新摘要并扇出
        this.conversationService = conversationService;  // SEND 前置：校验会话成员身份和群禁言状态
        this.dispatcher = dispatcher;                    // SEND 失败分支：向发送者推送 ERROR
        this.mediaService = mediaService;                // SEND 前置：按消息类型校验媒体对象
        this.linkPreview = linkPreview;                  // SEND 后置：落库后异步补充文本链接卡片
        this.recallService = recallService;              // RECALL 独立分支，不走 appender.append
        this.mentionService = mentionService;            // SEND 前置校验提及目标，落库后更新 mention_seq
        this.readService = readService;                  // READ 独立分支，不走 appender.append
        this.quoteService = quoteService;                // SEND 前置：校验引用目标并生成权威快照
    }

    @KafkaListener(topics = ImKafkaTopics.IN, groupId = "im-logic")
    public void onMessage(String json) throws Exception {
        Envelope env = mapper.readValue(json, Envelope.class);

        // 里程碑8：撤回走独立编排（自带成员/权限/时间窗校验）
        if ("RECALL".equals(env.getOp())) {
            recallService.recall(env);
            return;
        }

        // 里程碑10：已读上报走独立分支（不落库、不占 seq、不走幂等/媒体/@提及校验链）
        if ("READ".equals(env.getOp())) {
            readService.read(env);
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

        // 引用校验：客户端只提供 targetSeq，其余快照字段由服务端从同会话原消息重新生成。
        try {
            env.setBody(quoteService.enrich(env.getCid(), env.getType(), env.getBody()));
        } catch (QuoteValidationException ex) {
            pushError(env, ex.getReason());
            return;
        }

        // 里程碑9：@提及 校验（非群/非 TEXT 返回空；@非成员或越权 @所有人抛异常 → 整条拒绝回 ERROR）
        List<Long> mentionTargets;
        try {
            mentionTargets = mentionService.resolve(env.getCid(), env.getSenderId(), env.getType(), env.getBody());
        } catch (MentionValidationException ex) {
            pushError(env, ex.getReason());
            return;
        }

        // SEND 通过幂等、成员/禁言、媒体和 @提及校验后，才进入统一的定序、落库与扇出流程。
        long seq = appender.append(env.getCid(), env.getSenderId(), env.getType(), env.getBody(), env.getClientMsgId());

        // 里程碑9：定序后把命中成员 mention_seq 推进到本消息 seq（空目标 no-op）
        mentionService.apply(env.getCid(), seq, mentionTargets);

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
