package com.rbac.im.service;

import com.rbac.im.mapper.ImConversationMemberMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 里程碑9：@提及（群聊）。上行 TEXT body 可带 mentions:[userId] / mentionAll:true。
 * resolve 校验并返回被命中且需打标的成员（已展开 mentionAll、已排除发送者、去重）；
 * apply 把这些成员的 mention_seq 前向推进到本消息 seq。单聊忽略。
 */
@Service
public class MentionService {

    private final ConversationService conversationService;
    private final GroupService groupService;
    private final ImConversationMemberMapper memberMapper;
    private final boolean mentionAllAdminOnly;

    public MentionService(ConversationService conversationService,
                          GroupService groupService,
                          ImConversationMemberMapper memberMapper,
                          @Value("${rbac.im.mention-all-admin-only:true}") boolean mentionAllAdminOnly) {
        this.conversationService = conversationService;
        this.groupService = groupService;
        this.memberMapper = memberMapper;
        this.mentionAllAdminOnly = mentionAllAdminOnly;
    }

    /**
     * 校验 @提及 并返回需打标的成员 id（已排除发送者、去重）。非法即抛 MentionValidationException。
     * 非 TEXT / null body / 单聊会话一律返回空列表（不校验、不打标）。
     */
    public List<Long> resolve(String cid, long senderId, String type, Map<String, Object> body) {
        if (!"TEXT".equals(type) || body == null) {
            return List.of();
        }
        Long groupId = ConversationService.groupIdFromCid(cid);
        if (groupId == null) {
            return List.of();   // 单聊忽略
        }

        if (Boolean.TRUE.equals(body.get("mentionAll"))) {
            if (mentionAllAdminOnly && !groupService.isGroupManager(groupId, senderId)) {
                throw new MentionValidationException("MENTION_ALL_FORBIDDEN");
            }
            return conversationService.memberUserIds(cid).stream()
                    .filter(id -> id != senderId)
                    .distinct()
                    .toList();
        }

        Object raw = body.get("mentions");
        if (!(raw instanceof List<?> list) || list.isEmpty()) {
            return List.of();
        }
        Set<Long> targets = new LinkedHashSet<>();
        for (Object o : list) {
            if (!(o instanceof Number n)) {
                continue;   // 非数字元素跳过，防御式
            }
            long id = n.longValue();
            if (!conversationService.isMember(cid, id)) {
                throw new MentionValidationException("MENTION_NOT_MEMBER");
            }
            if (id != senderId) {
                targets.add(id);
            }
        }
        return new ArrayList<>(targets);
    }

    /** 把命中成员的 mention_seq 前向推进到本消息 seq；空目标直接返回。 */
    public void apply(String cid, long seq, List<Long> targets) {
        if (targets == null || targets.isEmpty()) {
            return;
        }
        memberMapper.advanceMentionSeq(cid, targets, seq);
    }
}
