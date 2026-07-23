package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.*;

class InboundMessageConsumerTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final SeqService seqService = mock(SeqService.class);
    private final ConversationService conversationService = mock(ConversationService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);
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
        when(seqService.nextSeq("c_1_2")).thenReturn(5L);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, seqService, conversationService, dispatcher);

        c.onMessage(json("cli-1"));

        verify(seqService).nextSeq("c_1_2");
        verify(repo).save(argThat((ImMessage m) -> m.getSeq() == 5L && "TEXT".equals(m.getType())));
        verify(dispatcher).dispatch(eq("c_1_2"), argThat(env -> env.getSeq() == 5L && "PUSH".equals(env.getOp())));
    }

    @Test
    void duplicate_clientMsgId_is_skipped() throws Exception {
        when(repo.existsBySenderIdAndClientMsgId(1L, "cli-1")).thenReturn(true);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, seqService, conversationService, dispatcher);

        c.onMessage(json("cli-1"));

        verify(seqService, never()).nextSeq(anyString());
        verify(repo, never()).save(any());
    }
}
