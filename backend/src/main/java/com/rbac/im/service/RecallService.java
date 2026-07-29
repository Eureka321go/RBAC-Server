package com.rbac.im.service;

import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Optional;

/** 消息撤回编排：6 步校验 + 原子清正文/标记 + RECALL 控制消息扇出。 */
@Service
public class RecallService {

    private final ImMessageRepository repo;
    private final MessageAppender appender;
    private final ConversationService conversationService;
    private final GroupService groupService;
    private final OutboundDispatcher dispatcher;
    private final int recallWindowSeconds;

    public RecallService(ImMessageRepository repo,
                         MessageAppender appender,
                         ConversationService conversationService,
                         GroupService groupService,
                         OutboundDispatcher dispatcher,
                         @Value("${rbac.im.recall-window-seconds:120}") int recallWindowSeconds) {
        this.repo = repo;
        this.appender = appender;
        this.conversationService = conversationService;
        this.groupService = groupService;
        this.dispatcher = dispatcher;
        this.recallWindowSeconds = recallWindowSeconds;
    }

    public void recall(Envelope env) {
        String cid = env.getCid();
        long operatorId = env.getSenderId();

        // 1) 成员校验
        if (!conversationService.isMember(cid, operatorId)) {
            pushError(env, "NOT_MEMBER");
            return;
        }

        // 2) 目标存在（targetSeq 缺失/非数字一并按目标不存在处理）
        Long targetSeq = parseTargetSeq(env.getBody());
        if (targetSeq == null) {
            pushError(env, "RECALL_TARGET_NOT_FOUND");
            return;
        }
        Optional<ImMessage> opt = repo.findByCidAndSeq(cid, targetSeq);
        if (opt.isEmpty()) {
            pushError(env, "RECALL_TARGET_NOT_FOUND");
            return;
        }
        ImMessage target = opt.get();

        // 3) 类型可撤
        if ("SYSTEM".equals(target.getType()) || "RECALL".equals(target.getType())) {
            pushError(env, "NOT_RECALLABLE");
            return;
        }

        // 4) 幂等：已撤回 → 静默返回（扛 Kafka 重投 + 重复点击）
        if (target.isRecalled()) {
            return;
        }

        // 5) 权限：本人；或群会话且操作者为 OWNER/ADMIN
        boolean allowed = target.getSenderId() != null && target.getSenderId() == operatorId;
        if (!allowed) {
            Long groupId = ConversationService.groupIdFromCid(cid);
            if (groupId != null && groupService.isGroupManager(groupId, operatorId)) {
                allowed = true;
            }
        }
        if (!allowed) {
            pushError(env, "RECALL_NO_PERMISSION");
            return;
        }

        // 6) 时间窗（对所有人生效，含管理员）
        long ts = target.getTs() == null ? 0L : target.getTs();
        if (System.currentTimeMillis() - ts > recallWindowSeconds * 1000L) {
            pushError(env, "RECALL_WINDOW_EXPIRED");
            return;
        }

        // 执行：先清正文/标记，再扇出 RECALL 控制消息
        repo.markRecalled(cid, targetSeq);
        appender.append(cid, operatorId, "RECALL", Map.of("targetSeq", targetSeq), null);
    }

    private Long parseTargetSeq(Map<String, Object> body) {
        if (body == null) {
            return null;
        }
        Object raw = body.get("targetSeq");
        return raw instanceof Number n ? n.longValue() : null;
    }

    private void pushError(Envelope src, String reason) {
        Envelope err = new Envelope();
        err.setOp("ERROR");
        err.setCid(src.getCid());
        err.setSenderId(src.getSenderId());
        err.setBody(Map.of("reason", reason));
        dispatcher.dispatchToUser(src.getSenderId(), err);
    }
}
