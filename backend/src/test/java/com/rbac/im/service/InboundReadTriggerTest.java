package com.rbac.im.service;

import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class InboundReadTriggerTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final MessageAppender appender = mock(MessageAppender.class);
    private final ConversationService conv = mock(ConversationService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);
    private final MediaService media = mock(MediaService.class);
    private final LinkPreviewService link = mock(LinkPreviewService.class);
    private final RecallService recall = mock(RecallService.class);
    private final MentionService mention = mock(MentionService.class);
    private final ReadService read = mock(ReadService.class);
    private final QuoteService quote = passthroughQuoteService();

    private final InboundMessageConsumer consumer = new InboundMessageConsumer(
            repo, appender, conv, dispatcher, media, link, recall, mention, read, quote);

    private QuoteService passthroughQuoteService() {
        QuoteService quoteService = mock(QuoteService.class);
        when(quoteService.enrich(anyString(), anyString(), any())).thenAnswer(invocation -> invocation.getArgument(2));
        return quoteService;
    }

    @Test
    void read_op_routes_to_readService_and_does_not_append() throws Exception {
        Envelope env = new Envelope();
        env.setOp("READ");
        env.setCid("c_1_2");
        env.setSenderId(2L);
        env.setBody(Map.of("readSeq", 5L));

        consumer.onMessage(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(env));

        verify(read).read(argThat(e -> "READ".equals(e.getOp())
                && "c_1_2".equals(e.getCid()) && e.getSenderId() == 2L));
        verify(appender, never()).append(anyString(), anyLong(), anyString(), any(), any());
        verify(recall, never()).recall(any());
    }
}
