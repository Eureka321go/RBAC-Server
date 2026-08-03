package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.push.candidate.AppendedMessage;
import com.rbac.im.push.candidate.PushCandidatePublisher;
import com.rbac.im.push.candidate.PushPreviewFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.Map;
import java.util.stream.Stream;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class InboundMessageConsumerTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final MessageAppender appender = mock(MessageAppender.class);
    private final ConversationService conversationService = mock(ConversationService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);
    private final RecallService recallService = mock(RecallService.class);
    private final PushCandidatePublisher pushPublisher = mock(PushCandidatePublisher.class);
    private final ObjectMapper mapper = new ObjectMapper();

    private String json(String clientMsgId) throws Exception {
        return json("SEND", "TEXT", Map.of("text", "hi"), clientMsgId);
    }

    private String json(String op, String type, Map<String, Object> body, String clientMsgId) throws Exception {
        Envelope e = new Envelope();
        e.setOp(op);
        e.setCid("c_1_2");
        e.setSenderId(1L);
        e.setType(type);
        e.setClientMsgId(clientMsgId);
        e.setBody(body);
        return mapper.writeValueAsString(e);
    }

    @Test
    void assigns_seq_persists_and_dispatches() throws Exception {
        when(repo.existsBySenderIdAndClientMsgId(1L, "cli-1")).thenReturn(false);
        when(conversationService.isMember("c_1_2", 1L)).thenReturn(true);
        when(appender.append("c_1_2", 1L, "TEXT", Map.of("text", "hi"), "cli-1"))
                .thenReturn(new AppendedMessage("msg-5", 5L, 5000L));
        MediaService mediaService = mock(MediaService.class);
        LinkPreviewService linkPreview = mock(LinkPreviewService.class);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, appender, conversationService, dispatcher,
                mediaService, linkPreview, recallService, mock(MentionService.class), mock(ReadService.class),
                passthroughQuoteService(), new PushPreviewFactory(), pushPublisher);

        c.onMessage(json("cli-1"));

        verify(appender).append("c_1_2", 1L, "TEXT", Map.of("text", "hi"), "cli-1");
        verify(mediaService, never()).validateForSend(any(), any(), any());
    }

    @Test
    void duplicate_clientMsgId_is_skipped() throws Exception {
        when(repo.existsBySenderIdAndClientMsgId(1L, "cli-1")).thenReturn(true);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, appender, conversationService, dispatcher,
                mock(MediaService.class), mock(LinkPreviewService.class), recallService, mock(MentionService.class),
                mock(ReadService.class), passthroughQuoteService(), new PushPreviewFactory(), pushPublisher);

        c.onMessage(json("cli-1"));

        verify(appender, never()).append(any(), any(), any(), any(), any());
        verify(pushPublisher, never()).publish(any());
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
                mock(ReadService.class), passthroughQuoteService(), new PushPreviewFactory(), pushPublisher);

        c.onMessage(json);

        verify(recallService).recall(argThat(env ->
                "RECALL".equals(env.getOp()) && "c_1_2".equals(env.getCid())
                        && env.getSenderId() == 1L));
        verify(appender, never()).append(any(), any(), any(), any(), any());
        verify(pushPublisher, never()).publish(any());
    }

    @ParameterizedTest
    @MethodSource("nonSendOperations")
    void nonSendOperationsDoNotPublishCandidates(String op) throws Exception {
        when(conversationService.isMember("c_1_2", 1L)).thenReturn(true);
        when(appender.append("c_1_2", 1L, "TEXT", Map.of("text", "metadata"), "cli-control"))
                .thenReturn(new AppendedMessage("msg-control", 6L, 6000L));
        InboundMessageConsumer c = new InboundMessageConsumer(repo, appender, conversationService, dispatcher,
                mock(MediaService.class), mock(LinkPreviewService.class), recallService, mock(MentionService.class),
                mock(ReadService.class), passthroughQuoteService(), new PushPreviewFactory(), pushPublisher);

        c.onMessage(json(op, "TEXT", Map.of("text", "metadata"), "cli-control"));

        verify(pushPublisher, never()).publish(any());
    }

    static Stream<String> nonSendOperations() {
        return Stream.of("LINK_PREVIEW", "ERROR", "PING");
    }

    @Test
    void unsupportedSendTypeDoesNotPublishCandidate() throws Exception {
        Map<String, Object> body = Map.of("event", "MEMBER_JOIN");
        when(conversationService.isMember("c_1_2", 1L)).thenReturn(true);
        when(appender.append("c_1_2", 1L, "SYSTEM", body, "cli-system"))
                .thenReturn(new AppendedMessage("msg-system", 7L, 7000L));
        InboundMessageConsumer c = new InboundMessageConsumer(repo, appender, conversationService, dispatcher,
                mock(MediaService.class), mock(LinkPreviewService.class), recallService, mock(MentionService.class),
                mock(ReadService.class), passthroughQuoteService(), new PushPreviewFactory(), pushPublisher);

        c.onMessage(json("SEND", "SYSTEM", body, "cli-system"));

        verify(pushPublisher, never()).publish(any());
    }

    private QuoteService passthroughQuoteService() {
        QuoteService quoteService = mock(QuoteService.class);
        when(quoteService.enrich(anyString(), anyString(), any())).thenAnswer(invocation -> invocation.getArgument(2));
        return quoteService;
    }
}
