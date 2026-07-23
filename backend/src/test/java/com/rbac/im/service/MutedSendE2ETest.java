package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

/**
 * 端到端验证：被禁言成员发送的 TEXT 消息在 InboundMessageConsumer 中被丢弃，
 * 并收到 ERROR(MUTED) 回执；解禁后恢复正常发送。
 *
 * <p>clientMsgId 幂等去重（{@code existsBySenderIdAndClientMsgId}）不区分 cid，且落在真实 MongoDB
 * （测试间不清库），故这里每次运行都用随机后缀，避免重复执行时被误判为重复消息而跳过。
 */
@SpringBootTest
@ActiveProfiles("test")
class MutedSendE2ETest {

    @Autowired GroupService groupService;
    @Autowired InboundMessageConsumer consumer;
    @Autowired ImMessageRepository repo;
    @MockBean OutboundDispatcher dispatcher;   // 拦截扇出，验证 ERROR 与丢弃

    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final long OWNER_ID = 6301L;
    private static final long MEMBER_ID = 6302L;

    @Test
    void mutedMember_sendDropped_andErrorPushed_thenUnmuteRestoresSend() throws Exception {
        String runId = UUID.randomUUID().toString();
        CreateGroupResult r = groupService.createGroup(OWNER_ID, "禁言群", List.of(MEMBER_ID));
        groupService.setMute(OWNER_ID, r.getGroupId(), MEMBER_ID, true);

        Envelope e = new Envelope();
        e.setOp("SEND");
        e.setCid(r.getCid());
        e.setSenderId(MEMBER_ID);
        e.setType("TEXT");
        e.setBody(Map.of("text", "x"));
        e.setClientMsgId("cm-muted-" + runId);
        consumer.onMessage(objectMapper.writeValueAsString(e));

        List<ImMessage> msgsAfterMute = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(r.getCid(), 0L, Limit.of(100));
        assertThat(msgsAfterMute)
                .noneMatch(m -> MEMBER_ID == m.getSenderId() && "TEXT".equals(m.getType()));

        verify(dispatcher).dispatchToUser(eq(MEMBER_ID), argThat(env ->
                "ERROR".equals(env.getOp()) && "MUTED".equals(env.getBody().get("reason"))));

        // 解禁后恢复正常发送
        groupService.setMute(OWNER_ID, r.getGroupId(), MEMBER_ID, false);

        Envelope e2 = new Envelope();
        e2.setOp("SEND");
        e2.setCid(r.getCid());
        e2.setSenderId(MEMBER_ID);
        e2.setType("TEXT");
        e2.setBody(Map.of("text", "y"));
        e2.setClientMsgId("cm-unmuted-" + runId);
        consumer.onMessage(objectMapper.writeValueAsString(e2));

        List<ImMessage> msgsAfterUnmute = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(r.getCid(), 0L, Limit.of(100));
        assertThat(msgsAfterUnmute)
                .anyMatch(m -> MEMBER_ID == m.getSenderId() && "TEXT".equals(m.getType())
                        && ("cm-unmuted-" + runId).equals(m.getClientMsgId()));

        verify(dispatcher, atLeastOnce()).dispatch(eq(r.getCid()), any());
    }
}
