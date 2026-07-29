package com.rbac.im.service;

import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ReadServiceTest {

    private final ConversationService conv = mock(ConversationService.class);
    private final ImConversationMemberMapper memberMapper = mock(ImConversationMemberMapper.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);

    private final ReadService svc = new ReadService(conv, memberMapper, dispatcher);

    private Envelope readEnv(String cid, long readerId, Object readSeq) {
        Envelope e = new Envelope();
        e.setOp("READ");
        e.setCid(cid);
        e.setSenderId(readerId);
        e.setBody(readSeq == null ? Map.of() : Map.of("readSeq", readSeq));
        return e;
    }

    @Test
    void single_chat_advances_and_fans_out_to_peer_excluding_reader() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);
        when(conv.lastMsgSeq("c_1_2")).thenReturn(5L);
        when(memberMapper.advanceReadSeq("c_1_2", 2L, 5L)).thenReturn(1);
        when(conv.memberUserIds("c_1_2")).thenReturn(List.of(1L, 2L));

        svc.read(readEnv("c_1_2", 2L, 5L));

        verify(memberMapper).advanceReadSeq("c_1_2", 2L, 5L);
        // 回执只发给对端 1，不发给阅读者 2
        verify(dispatcher).dispatchToUser(eq(1L), argThat(env ->
                "READ".equals(env.getOp()) && "c_1_2".equals(env.getCid())
                        && env.getSenderId() == 2L
                        && Long.valueOf(5L).equals(((Number) env.getBody().get("readSeq")).longValue())));
        verify(dispatcher, never()).dispatchToUser(eq(2L), any());
    }

    @Test
    void clamps_readSeq_to_last_msg_seq() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);
        when(conv.lastMsgSeq("c_1_2")).thenReturn(5L);
        when(memberMapper.advanceReadSeq("c_1_2", 2L, 5L)).thenReturn(1);
        when(conv.memberUserIds("c_1_2")).thenReturn(List.of(1L, 2L));

        svc.read(readEnv("c_1_2", 2L, 999L)); // 上报超大 seq

        verify(memberMapper).advanceReadSeq("c_1_2", 2L, 5L); // 钳制到 5
    }

    @Test
    void stale_report_not_advanced_no_fanout() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);
        when(conv.lastMsgSeq("c_1_2")).thenReturn(5L);
        when(memberMapper.advanceReadSeq("c_1_2", 2L, 3L)).thenReturn(0); // 未推进

        svc.read(readEnv("c_1_2", 2L, 3L));

        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }

    @Test
    void group_chat_advances_but_no_fanout() {
        when(conv.isMember("g_10", 2L)).thenReturn(true);
        when(conv.lastMsgSeq("g_10")).thenReturn(5L);
        when(memberMapper.advanceReadSeq("g_10", 2L, 5L)).thenReturn(1);

        svc.read(readEnv("g_10", 2L, 5L));

        verify(memberMapper).advanceReadSeq("g_10", 2L, 5L);
        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }

    @Test
    void non_member_noop() {
        when(conv.isMember("c_1_2", 9L)).thenReturn(false);

        svc.read(readEnv("c_1_2", 9L, 5L));

        verify(memberMapper, never()).advanceReadSeq(anyString(), anyLong(), anyLong());
        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }

    @Test
    void missing_or_invalid_readSeq_noop() {
        when(conv.isMember("c_1_2", 2L)).thenReturn(true);

        svc.read(readEnv("c_1_2", 2L, null));            // 缺失
        svc.read(readEnv("c_1_2", 2L, "notNumber"));     // 非数字

        verify(memberMapper, never()).advanceReadSeq(anyString(), anyLong(), anyLong());
        verify(dispatcher, never()).dispatchToUser(anyLong(), any());
    }
}
