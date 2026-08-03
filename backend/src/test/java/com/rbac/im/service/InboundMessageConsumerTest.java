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
    private final ConversationService conversationService = mock(ConversationService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);
    private final RecallService recallService = mock(RecallService.class);
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
        when(conversationService.isMember("c_1_2", 1L)).thenReturn(true);
        when(appender.append("c_1_2", 1L, "TEXT", Map.of("text", "hi"), "cli-1")).thenReturn(5L);
        MediaService mediaService = mock(MediaService.class);
        LinkPreviewService linkPreview = mock(LinkPreviewService.class);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, appender, conversationService, dispatcher, mediaService, linkPreview, recallService, mock(MentionService.class), mock(ReadService.class), mock(QuoteService.class));

        c.onMessage(json("cli-1"));

        verify(appender).append("c_1_2", 1L, "TEXT", Map.of("text", "hi"), "cli-1");
        verify(mediaService, never()).validateForSend(any(), any(), any());
    }

    @Test
    void duplicate_clientMsgId_is_skipped() throws Exception {
        when(repo.existsBySenderIdAndClientMsgId(1L, "cli-1")).thenReturn(true);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, appender, conversationService, dispatcher, mock(MediaService.class), mock(LinkPreviewService.class), recallService, mock(MentionService.class), mock(ReadService.class), mock(QuoteService.class));

        c.onMessage(json("cli-1"));

        verify(appender, never()).append(any(), any(), any(), any(), any());
    }

    @Test
    void recall_op_is_routed_to_recall_service_and_skips_append() throws Exception {
        Envelope e = new Envelope();
        e.setOp("RECALL");
        e.setCid("c_1_2");
        e.setSenderId(1L);
        e.setBody(Map.of("targetSeq", 5L));
        String json = mapper.writeValueAsString(e);

        InboundMessageConsumer c = new InboundMessageConsumer(
                repo, appender, conversationService, dispatcher,
                mock(MediaService.class), mock(LinkPreviewService.class), recallService, mock(MentionService.class),
                mock(ReadService.class), mock(QuoteService.class));

        c.onMessage(json);

        verify(recallService).recall(argThat(env ->
                "RECALL".equals(env.getOp()) && "c_1_2".equals(env.getCid())
                        && env.getSenderId() == 1L));
        verify(appender, never()).append(any(), any(), any(), any(), any());
    }
}
