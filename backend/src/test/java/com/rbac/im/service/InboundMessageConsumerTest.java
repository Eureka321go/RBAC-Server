package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class InboundMessageConsumerTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final MessageAppender appender = mock(MessageAppender.class);
    private final ObjectMapper mapper = new ObjectMapper();

    private String json(String clientMsgId) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND");
        e.setCid("c_1_2");
        e.setSenderId(1L);
        e.setType("TEXT");
        e.setClientMsgId(clientMsgId);
        e.setBody(Map.of("text", "hi"));
        return mapper.writeValueAsString(e);
    }

    @Test
    void assigns_seq_persists_and_dispatches() throws Exception {
        when(repo.existsBySenderIdAndClientMsgId(1L, "cli-1")).thenReturn(false);
        when(appender.append("c_1_2", 1L, "TEXT", Map.of("text", "hi"), "cli-1")).thenReturn(5L);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, appender);

        c.onMessage(json("cli-1"));

        verify(appender).append("c_1_2", 1L, "TEXT", Map.of("text", "hi"), "cli-1");
    }

    @Test
    void duplicate_clientMsgId_is_skipped() throws Exception {
        when(repo.existsBySenderIdAndClientMsgId(1L, "cli-1")).thenReturn(true);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, appender);

        c.onMessage(json("cli-1"));

        verify(appender, never()).append(any(), any(), any(), any(), any());
    }
}
