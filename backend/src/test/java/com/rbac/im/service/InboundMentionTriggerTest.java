package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.push.candidate.AppendedMessage;
import com.rbac.im.push.candidate.PushCandidatePublisher;
import com.rbac.im.push.candidate.PushPreviewFactory;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** 里程碑9：InboundMessageConsumer 接线 @提及 —— resolve 校验失败回 ERROR、正常路径 append 后 apply。 */
class InboundMentionTriggerTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final MessageAppender appender = mock(MessageAppender.class);
    private final ConversationService conversationService = mock(ConversationService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);
    private final MediaService mediaService = mock(MediaService.class);
    private final LinkPreviewService linkPreview = mock(LinkPreviewService.class);
    private final RecallService recallService = mock(RecallService.class);
    private final MentionService mentionService = mock(MentionService.class);
    private final ReadService readService = mock(ReadService.class);
    private final QuoteService quoteService = passthroughQuoteService();
    private final PushCandidatePublisher pushPublisher = mock(PushCandidatePublisher.class);
    private final ObjectMapper mapper = new ObjectMapper();

    private InboundMessageConsumer consumer() {
        return new InboundMessageConsumer(repo, appender, conversationService, dispatcher,
                mediaService, linkPreview, recallService, mentionService, readService, quoteService,
                new PushPreviewFactory(), pushPublisher);
    }

    private QuoteService passthroughQuoteService() {
        QuoteService quoteService = mock(QuoteService.class);
        when(quoteService.enrich(anyString(), anyString(), any())).thenAnswer(invocation -> invocation.getArgument(2));
        return quoteService;
    }

    private String groupText(Map<String, Object> body) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND");
        e.setCid("g_100");
        e.setSenderId(10L);
        e.setType("TEXT");
        e.setClientMsgId("cli-1");
        e.setBody(body);
        return mapper.writeValueAsString(e);
    }

    @Test
    void mention_validation_failure_pushes_error_and_skips_append() throws Exception {
        when(conversationService.isMember("g_100", 10L)).thenReturn(true);
        when(conversationService.isGroupMuted("g_100", 10L)).thenReturn(false);
        when(mentionService.resolve(eq("g_100"), eq(10L), eq("TEXT"), any()))
                .thenThrow(new MentionValidationException("MENTION_ALL_FORBIDDEN"));

        consumer().onMessage(groupText(Map.of("text", "hi", "mentionAll", true)));

        verify(appender, never()).append(any(), any(), any(), any(), any());
        verify(pushPublisher, never()).publish(any());
        ArgumentCaptor<Envelope> cap = ArgumentCaptor.forClass(Envelope.class);
        verify(dispatcher).dispatchToUser(eq(10L), cap.capture());
        assertEquals("ERROR", cap.getValue().getOp());
        assertEquals("MENTION_ALL_FORBIDDEN", cap.getValue().getBody().get("reason"));
    }

    @Test
    void resolved_targets_applied_after_append() throws Exception {
        Map<String, Object> body = Map.of("text", "hi", "mentions", List.of(20, 30));
        when(conversationService.isMember("g_100", 10L)).thenReturn(true);
        when(conversationService.isGroupMuted("g_100", 10L)).thenReturn(false);
        when(mentionService.resolve(eq("g_100"), eq(10L), eq("TEXT"), any()))
                .thenReturn(List.of(20L, 30L));
        when(appender.append(eq("g_100"), eq(10L), eq("TEXT"), any(), eq("cli-1")))
                .thenReturn(new AppendedMessage("msg-7", 7L, 7000L));

        consumer().onMessage(groupText(body));

        verify(mentionService).apply("g_100", 7L, List.of(20L, 30L));
    }

    @Test
    void publishesCandidateOnlyAfterMentionStateAdvances() throws Exception {
        InOrder order = inOrder(appender, mentionService, pushPublisher);
        when(conversationService.isMember("g_100", 10L)).thenReturn(true);
        when(conversationService.isGroupMuted("g_100", 10L)).thenReturn(false);
        when(appender.append(eq("g_100"), eq(10L), eq("TEXT"), any(), eq("cli-1")))
                .thenReturn(new AppendedMessage("msg-7", 7L, 7000L));
        when(mentionService.resolve(eq("g_100"), eq(10L), eq("TEXT"), any()))
                .thenReturn(List.of(20L));

        consumer().onMessage(groupText(Map.of("text", "hi", "mentions", List.of(20))));

        order.verify(appender).append(eq("g_100"), eq(10L), eq("TEXT"), any(), eq("cli-1"));
        order.verify(mentionService).apply("g_100", 7L, List.of(20L));
        order.verify(pushPublisher).publish(argThat(candidate ->
                candidate.version() == 1
                        && candidate.msgId().equals("msg-7")
                        && candidate.cid().equals("g_100")
                        && candidate.seq() == 7L
                        && candidate.senderId() == 10L
                        && candidate.type().equals("TEXT")
                        && candidate.preview().equals("hi")
                        && candidate.mentionTargetIds().equals(List.of(20L))
                        && candidate.ts() == 7000L));
    }

    @Test
    void candidatePublisherFailureDoesNotFailAcceptedMessage() throws Exception {
        when(conversationService.isMember("g_100", 10L)).thenReturn(true);
        when(conversationService.isGroupMuted("g_100", 10L)).thenReturn(false);
        when(appender.append(eq("g_100"), eq(10L), eq("TEXT"), any(), eq("cli-1")))
                .thenReturn(new AppendedMessage("msg-8", 8L, 8000L));
        when(mentionService.resolve(eq("g_100"), eq(10L), eq("TEXT"), any()))
                .thenReturn(List.of());
        doThrow(new RuntimeException("kafka unavailable")).when(pushPublisher).publish(any());

        assertDoesNotThrow(() -> consumer().onMessage(groupText(Map.of("text", "accepted"))));

        verify(mentionService).apply("g_100", 8L, List.of());
        verify(pushPublisher).publish(any());
    }
}
