package com.rbac.im.push.delivery;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.push.candidate.PushCandidate;
import com.rbac.im.push.registration.PushRegistrationService;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class PushRecipientResolver {

    private final ImConversationMemberMapper memberMapper;
    private final PushRegistrationService registrations;
    private final Clock clock;

    public PushRecipientResolver(ImConversationMemberMapper memberMapper,
                                 PushRegistrationService registrations,
                                 Clock clock) {
        this.memberMapper = memberMapper;
        this.registrations = registrations;
        this.clock = clock;
    }

    public List<PushTarget> resolve(PushCandidate candidate) {
        Set<Long> mentioned = Set.copyOf(candidate.mentionTargetIds());
        Map<Long, Boolean> allowed = memberMapper.selectList(
                        new LambdaQueryWrapper<ImConversationMember>()
                                .eq(ImConversationMember::getCid, candidate.cid()))
                .stream()
                .filter(member -> member.getUserId() != candidate.senderId())
                .filter(member -> !Integer.valueOf(1).equals(member.getMuted())
                        || mentioned.contains(member.getUserId()))
                .collect(java.util.stream.Collectors.toMap(
                        ImConversationMember::getUserId,
                        member -> mentioned.contains(member.getUserId()),
                        (first, ignored) -> first,
                        LinkedHashMap::new));
        return registrations.findFreshEnabledByUserIds(
                        allowed.keySet(), LocalDateTime.now(clock).minusDays(30))
                .stream()
                .filter(row -> allowed.containsKey(row.getUserId()))
                .map(row -> new PushTarget(row, row.getUserId(), allowed.get(row.getUserId())))
                .toList();
    }
}
