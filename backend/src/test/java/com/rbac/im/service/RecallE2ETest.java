package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.CreateGroupResult;
import com.rbac.im.vo.ImMessageVO;
import com.rbac.im.vo.PullResult;
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

/**
 * 端到端验证撤回：群主发一条 TEXT → 通过 InboundMessageConsumer 收 op=RECALL →
 * 原消息 recalled=true 且正文清空；新增一条 RECALL 控制消息 body.targetSeq 指向原 seq；
 * MessageQueryService.pull 侧被撤消息 body 为空、并能拉到 RECALL 控制消息。
 */
@SpringBootTest
@ActiveProfiles("test")
class RecallE2ETest {

    @Autowired GroupService groupService;
    @Autowired InboundMessageConsumer consumer;
    @Autowired ImMessageRepository repo;
    @Autowired MessageQueryService queryService;
    @MockBean OutboundDispatcher dispatcher;   // 拦截扇出，避免真发 Kafka

    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final long OWNER_ID = 6401L;
    private static final long MEMBER_ID = 6402L;

    @Test
    void selfRecall_marksRecalled_blanksBody_andFansOutRecallControl() throws Exception {
        String runId = UUID.randomUUID().toString();
        CreateGroupResult r = groupService.createGroup(OWNER_ID, "撤回群", List.of(MEMBER_ID));
        String cid = r.getCid();

        // 群主发一条 TEXT
        Envelope send = new Envelope();
        send.setOp("SEND");
        send.setCid(cid);
        send.setSenderId(OWNER_ID);
        send.setType("TEXT");
        send.setBody(Map.of("text", "secret"));
        send.setClientMsgId("cm-recall-" + runId);
        consumer.onMessage(objectMapper.writeValueAsString(send));

        // 找到刚发的 TEXT 消息拿 seq
        List<ImMessage> before = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(100));
        ImMessage text = before.stream()
                .filter(m -> "TEXT".equals(m.getType()) && OWNER_ID == m.getSenderId())
                .findFirst().orElseThrow();
        long targetSeq = text.getSeq();

        // 撤回
        Envelope recall = new Envelope();
        recall.setOp("RECALL");
        recall.setCid(cid);
        recall.setSenderId(OWNER_ID);
        recall.setBody(Map.of("targetSeq", targetSeq));
        consumer.onMessage(objectMapper.writeValueAsString(recall));

        // 原消息 recalled=true 且 body 清空
        ImMessage recalled = repo.findByCidAndSeq(cid, targetSeq).orElseThrow();
        assertThat(recalled.isRecalled()).isTrue();
        assertThat(recalled.getBody()).isEmpty();

        // 生成了一条 RECALL 控制消息，body.targetSeq 指向原 seq
        List<ImMessage> after = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, 0L, Limit.of(100));
        ImMessage control = after.stream()
                .filter(m -> "RECALL".equals(m.getType()))
                .findFirst().orElseThrow();
        assertThat(control.getSeq()).isGreaterThan(targetSeq);
        assertThat(((Number) control.getBody().get("targetSeq")).longValue()).isEqualTo(targetSeq);

        // pull 侧：被撤消息 body 空；能拉到 RECALL 控制消息
        PullResult pr = queryService.pull(cid, 0L, 100, OWNER_ID);
        ImMessageVO recalledVo = pr.getMessages().stream()
                .filter(v -> v.getSeq().equals(targetSeq)).findFirst().orElseThrow();
        assertThat(recalledVo.isRecalled()).isTrue();
        assertThat(recalledVo.getBody()).isEmpty();
        assertThat(pr.getMessages()).anyMatch(v -> "RECALL".equals(v.getType()));
    }
}
