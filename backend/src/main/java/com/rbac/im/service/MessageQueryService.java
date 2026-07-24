package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.vo.ImMessageVO;
import com.rbac.im.vo.PullResult;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;

import java.util.List;

/** 单会话消息增量拉取：成员校验 + forward 分页。 */
@Service
public class MessageQueryService {

    private static final int DEFAULT_LIMIT = 50;
    private static final int MAX_LIMIT = 200;

    private final ImMessageRepository repo;
    private final ConversationService conversationService;
    private final MediaUrlEnricher enricher;

    public MessageQueryService(ImMessageRepository repo, ConversationService conversationService,
                                MediaUrlEnricher enricher) {
        this.repo = repo;
        this.conversationService = conversationService;
        this.enricher = enricher;
    }

    public PullResult pull(String cid, Long sinceSeq, Integer limit, long requesterUserId) {
        if (!conversationService.isMember(cid, requesterUserId)) {
            throw new BusinessException(403, "im.conversation.notMember");
        }
        long since = sinceSeq == null ? 0L : sinceSeq;
        int size = normalizeLimit(limit);

        // 多取 1 条用于判断 hasMore
        List<ImMessage> rows = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(cid, since, Limit.of(size + 1));
        boolean hasMore = rows.size() > size;
        List<ImMessage> page = hasMore ? rows.subList(0, size) : rows;

        List<ImMessageVO> messages = page.stream().map(this::toVo).toList();
        long nextSinceSeq = page.isEmpty() ? since : page.get(page.size() - 1).getSeq();

        PullResult result = new PullResult();
        result.setMessages(messages);
        result.setHasMore(hasMore);
        result.setNextSinceSeq(nextSinceSeq);
        return result;
    }

    private int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private ImMessageVO toVo(ImMessage m) {
        ImMessageVO vo = new ImMessageVO();
        vo.setCid(m.getCid());
        vo.setSeq(m.getSeq());
        vo.setMsgId(m.getMsgId());
        vo.setSenderId(m.getSenderId());
        vo.setType(m.getType());
        vo.setBody(enricher.enrich(m.getType(), m.getBody()));
        vo.setRecalled(m.isRecalled());
        vo.setTs(m.getTs());
        return vo;
    }
}
