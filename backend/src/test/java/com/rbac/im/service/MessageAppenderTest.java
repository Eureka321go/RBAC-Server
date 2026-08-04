package com.rbac.im.service;

import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.push.candidate.AppendedMessage;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class MessageAppenderTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final SeqService seqService = mock(SeqService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);
    private final ImConversationMapper conversationMapper = mock(ImConversationMapper.class);
    private final MediaUrlEnricher enricher = mock(MediaUrlEnricher.class);
    private final MessageAppender appender = new MessageAppender(
            repo, seqService, dispatcher, conversationMapper, enricher);

    @Test
    void appendSavesUpdatesSummaryDispatchesAndReturnsPersistedIdentity() {
        String cid = "c_9001_9002";
        Map<String, Object> body = Map.of("text", "在吗");
        ImConversation conversation = new ImConversation();
        conversation.setCid(cid);
        when(seqService.nextSeq(cid)).thenReturn(7L);
        when(conversationMapper.selectOne(any())).thenReturn(conversation);
        when(enricher.enrich("TEXT", body)).thenReturn(body);
        InOrder order = inOrder(repo, conversationMapper, dispatcher);

        AppendedMessage appended = appender.append(cid, 9001L, "TEXT", body, "cm-1");

        ArgumentCaptor<ImMessage> saved = ArgumentCaptor.forClass(ImMessage.class);
        order.verify(repo).save(saved.capture());
        order.verify(conversationMapper).selectOne(any());
        order.verify(conversationMapper).updateById(conversation);
        ArgumentCaptor<Envelope> outbound = ArgumentCaptor.forClass(Envelope.class);
        order.verify(dispatcher).dispatch(eq(cid), outbound.capture());

        ImMessage message = saved.getValue();
        assertThat(appended.msgId()).isEqualTo(message.getMsgId()).isNotBlank();
        assertThat(appended.seq()).isEqualTo(message.getSeq()).isEqualTo(7L);
        assertThat(appended.ts()).isEqualTo(message.getTs()).isPositive();
        assertThat(message.getBody()).isEqualTo(body);
        assertThat(message.getClientMsgId()).isEqualTo("cm-1");
        assertThat(conversation.getLastMsgSeq()).isEqualTo(7L);
        assertThat(conversation.getLastMsgPreview()).isEqualTo("在吗");
        assertThat(conversation.getLastMsgTs()).isEqualTo(appended.ts());
        assertThat(outbound.getValue().getMsgId()).isEqualTo(appended.msgId());
        assertThat(outbound.getValue().getSeq()).isEqualTo(7L);
    }

    @Test
    void previewForSystemIsPlaceholder() {
        assertThat(MessageAppender.preview("SYSTEM", Map.of("event", "MEMBER_JOIN")))
                .isEqualTo("[系统消息]");
    }

    @Test
    void previewOfRecallIsFriendlyText() {
        assertThat(MessageAppender.preview("RECALL", Map.of("targetSeq", 5L)))
                .isEqualTo("[撤回了一条消息]");
    }
}
