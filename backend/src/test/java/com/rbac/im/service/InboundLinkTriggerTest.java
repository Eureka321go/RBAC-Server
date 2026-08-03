package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.push.candidate.AppendedMessage;
import com.rbac.im.push.candidate.PushCandidatePublisher;
import com.rbac.im.push.candidate.PushPreviewFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class InboundLinkTriggerTest {

    ImMessageRepository repo;
    MessageAppender appender;
    ConversationService conversationService;
    OutboundDispatcher dispatcher;
    MediaService mediaService;
    LinkPreviewService linkPreview;
    QuoteService quoteService;
    PushCandidatePublisher pushPublisher;
    InboundMessageConsumer consumer;
    ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setup() {
        repo = mock(ImMessageRepository.class);
        appender = mock(MessageAppender.class);
        conversationService = mock(ConversationService.class);
        dispatcher = mock(OutboundDispatcher.class);
        mediaService = mock(MediaService.class);
        linkPreview = mock(LinkPreviewService.class);
        quoteService = passthroughQuoteService();
        pushPublisher = mock(PushCandidatePublisher.class);
        consumer = new InboundMessageConsumer(repo, appender, conversationService, dispatcher,
                mediaService, linkPreview, mock(RecallService.class), mock(MentionService.class),
                mock(ReadService.class), quoteService, new PushPreviewFactory(), pushPublisher);
        when(conversationService.isMember(anyString(), anyLong())).thenReturn(true);
        when(conversationService.isGroupMuted(anyString(), anyLong())).thenReturn(false);
    }

    private QuoteService passthroughQuoteService() {
        QuoteService quoteService = mock(QuoteService.class);
        when(quoteService.enrich(anyString(), anyString(), any())).thenAnswer(invocation -> invocation.getArgument(2));
        return quoteService;
    }

    private String json(String type, Map<String, Object> body) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND"); e.setCid("c_1_2"); e.setSenderId(1L); e.setType(type); e.setBody(body);
        e.setClientMsgId("cm1");
        return mapper.writeValueAsString(e);
    }

    @Test
    void text_with_url_triggers_link_preview_after_append() throws Exception {
        when(appender.append(eq("c_1_2"), eq(1L), eq("TEXT"), any(), eq("cm1")))
                .thenReturn(new AppendedMessage("msg-99", 99L, 9900L));
        consumer.onMessage(json("TEXT", Map.of("text", "看 https://x.com/a")));
        verify(appender).append(eq("c_1_2"), eq(1L), eq("TEXT"), any(), eq("cm1"));
        verify(linkPreview).tryEnrich("c_1_2", 99L, "看 https://x.com/a");
    }

    @Test
    void image_does_not_trigger_link_preview() throws Exception {
        // MediaService.isMedia 是静态方法，走真实实现："IMAGE" 命中媒体分支；
        // 只需把 validateForSend 打桩为不抛，聚焦断言 tryEnrich 未被调用。
        doNothing().when(mediaService).validateForSend(anyString(), anyString(), any());
        when(appender.append(anyString(), anyLong(), eq("IMAGE"), any(), anyString()))
                .thenReturn(new AppendedMessage("msg-5", 5L, 5000L));
        consumer.onMessage(json("IMAGE", Map.of("objectKey", "im/c_1_2/199001/x.png")));
        verify(linkPreview, never()).tryEnrich(anyString(), anyLong(), any());
    }
}
