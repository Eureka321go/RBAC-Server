package com.rbac.im.service;

import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RecallServiceTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final MessageAppender appender = mock(MessageAppender.class);
    private final ConversationService conv = mock(ConversationService.class);
    private final GroupService group = mock(GroupService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);

    // recallWindowSeconds=120（构造注入，绕开 Spring @Value）
    private final RecallService svc =
            new RecallService(repo, appender, conv, group, dispatcher, 120);

    private ImMessage target(String cid, long seq, long senderId, String type, long ts) {
        ImMessage m = new ImMessage();
        m.setCid(cid);
        m.setSeq(seq);
        m.setMsgId("m" + seq);
        m.setSenderId(senderId);
        m.setType(type);
        m.setBody(Map.of("text", "secret"));
        m.setTs(ts);
        return m;
    }

    private Envelope recallEnv(String cid, long operatorId, long targetSeq) {
        Envelope e = new Envelope();
        e.setOp("RECALL");
        e.setCid(cid);
        e.setSenderId(operatorId);
        e.setBody(Map.of("targetSeq", targetSeq));
        return e;
    }

    @Test
    void self_recall_within_window_marks_and_fans_out() {
        when(conv.isMember("c_1_2", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L))
                .thenReturn(Optional.of(target("c_1_2", 5L, 1L, "TEXT", System.currentTimeMillis())));

        svc.recall(recallEnv("c_1_2", 1L, 5L));

        verify(repo).markRecalled("c_1_2", 5L);
        verify(appender).append("c_1_2", 1L, "RECALL", Map.of("targetSeq", 5L), null);
        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }

    @Test
    void group_admin_can_recall_member_message() {
        when(conv.isMember("g_10", 2L)).thenReturn(true);
        when(repo.findByCidAndSeq("g_10", 5L))
                .thenReturn(Optional.of(target("g_10", 5L, 1L, "TEXT", System.currentTimeMillis())));
        when(group.isGroupManager(10L, 2L)).thenReturn(true);

        svc.recall(recallEnv("g_10", 2L, 5L)); // 操作者 2 撤成员 1 的消息

        verify(repo).markRecalled("g_10", 5L);
        verify(appender).append("g_10", 2L, "RECALL", Map.of("targetSeq", 5L), null);
    }

    @Test
    void single_chat_non_sender_is_rejected() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L))
                .thenReturn(Optional.of(target("c_1_2", 5L, 1L, "TEXT", System.currentTimeMillis())));

        svc.recall(recallEnv("c_1_2", 2L, 5L)); // 单聊 groupId 为 null → 只能本人

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(appender, never()).append(any(), any(), any(), any(), any());
        verify(dispatcher).dispatchToUser(eq(2L), argThat(e ->
                "ERROR".equals(e.getOp()) && "RECALL_NO_PERMISSION".equals(e.getBody().get("reason"))));
    }

    @Test
    void group_plain_member_recalling_others_is_rejected() {
        when(conv.isMember("g_10", 3L)).thenReturn(true);
        when(repo.findByCidAndSeq("g_10", 5L))
                .thenReturn(Optional.of(target("g_10", 5L, 1L, "TEXT", System.currentTimeMillis())));
        when(group.isGroupManager(10L, 3L)).thenReturn(false);

        svc.recall(recallEnv("g_10", 3L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(3L), argThat(e ->
                "RECALL_NO_PERMISSION".equals(e.getBody().get("reason"))));
    }

    @Test
    void expired_window_is_rejected_even_for_own_message() {
        long old = System.currentTimeMillis() - 200_000L; // 200s > 120s 窗
        when(conv.isMember("c_1_2", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L))
                .thenReturn(Optional.of(target("c_1_2", 5L, 1L, "TEXT", old)));

        svc.recall(recallEnv("c_1_2", 1L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(1L), argThat(e ->
                "RECALL_WINDOW_EXPIRED".equals(e.getBody().get("reason"))));
    }

    @Test
    void admin_expired_window_also_rejected() {
        long old = System.currentTimeMillis() - 200_000L;
        when(conv.isMember("g_10", 2L)).thenReturn(true);
        when(repo.findByCidAndSeq("g_10", 5L))
                .thenReturn(Optional.of(target("g_10", 5L, 1L, "TEXT", old)));
        when(group.isGroupManager(10L, 2L)).thenReturn(true);

        svc.recall(recallEnv("g_10", 2L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(2L), argThat(e ->
                "RECALL_WINDOW_EXPIRED".equals(e.getBody().get("reason"))));
    }

    @Test
    void target_not_found_is_rejected() {
        when(conv.isMember("c_1_2", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L)).thenReturn(Optional.empty());

        svc.recall(recallEnv("c_1_2", 1L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(1L), argThat(e ->
                "RECALL_TARGET_NOT_FOUND".equals(e.getBody().get("reason"))));
    }

    @Test
    void recalling_system_or_recall_type_is_rejected() {
        when(conv.isMember("g_10", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("g_10", 5L))
                .thenReturn(Optional.of(target("g_10", 5L, 1L, "SYSTEM", System.currentTimeMillis())));

        svc.recall(recallEnv("g_10", 1L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(1L), argThat(e ->
                "NOT_RECALLABLE".equals(e.getBody().get("reason"))));
    }

    @Test
    void already_recalled_is_idempotent_silent() {
        ImMessage t = target("c_1_2", 5L, 1L, "TEXT", System.currentTimeMillis());
        t.setRecalled(true);
        when(conv.isMember("c_1_2", 1L)).thenReturn(true);
        when(repo.findByCidAndSeq("c_1_2", 5L)).thenReturn(Optional.of(t));

        svc.recall(recallEnv("c_1_2", 1L, 5L));

        verify(repo, never()).markRecalled(any(), anyLong());
        verify(appender, never()).append(any(), any(), any(), any(), any());
        verify(dispatcher, never()).dispatchToUser(anyLong(), any()); // 不报错
    }

    @Test
    void non_member_is_rejected() {
        when(conv.isMember("c_1_2", 9L)).thenReturn(false);

        svc.recall(recallEnv("c_1_2", 9L, 5L));

        verify(repo, never()).findByCidAndSeq(any(), anyLong());
        verify(dispatcher).dispatchToUser(eq(9L), argThat(e ->
                "NOT_MEMBER".equals(e.getBody().get("reason"))));
    }
}
