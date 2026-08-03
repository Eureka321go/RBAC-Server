package com.rbac.im.push.delivery;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.push.candidate.PushCandidate;
import com.rbac.im.push.registration.ImPushRegistration;
import com.rbac.im.push.registration.PushRegistrationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class PushRecipientResolverTest {

    private final ImConversationMemberMapper memberMapper = mock(ImConversationMemberMapper.class);
    private final PushRegistrationService registrations = mock(PushRegistrationService.class);
    private final Clock clock = Clock.fixed(Instant.parse("2026-07-30T08:15:30Z"), ZoneOffset.UTC);
    private PushRecipientResolver resolver;

    @BeforeEach
    void setUp() {
        resolver = new PushRecipientResolver(memberMapper, registrations, clock);
    }

    @Test
    void resolve_excludesSenderAndMutedOrdinary_butKeepsMutedMention() {
        when(memberMapper.selectList(any())).thenReturn(List.of(
                member(10L, false), member(20L, true), member(30L, true), member(40L, false)));
        when(registrations.findFreshEnabledByUserIds(any(), any())).thenReturn(List.of(
                registration(10L), registration(20L), registration(30L), registration(40L)));

        List<PushTarget> targets = resolver.resolve(candidate(10L, List.of(30L)));

        assertThat(targets).extracting(PushTarget::recipientUserId)
                .containsExactlyInAnyOrder(30L, 40L);
        assertThat(targets.stream().filter(PushTarget::mentioned)
                .map(PushTarget::recipientUserId)).containsExactly(30L);
        ArgumentCaptor<java.util.Collection<Long>> requestedUserIds = ArgumentCaptor.forClass(java.util.Collection.class);
        verify(registrations).findFreshEnabledByUserIds(requestedUserIds.capture(), any());
        assertThat(requestedUserIds.getValue()).containsExactlyInAnyOrder(30L, 40L);
    }

    @Test
    void resolve_usesOneMemberQueryAndOneBatchRegistrationQueryWithThirtyDayThreshold() {
        when(memberMapper.selectList(any())).thenReturn(List.of(member(20L, false)));
        when(registrations.findFreshEnabledByUserIds(any(), any())).thenReturn(List.of(registration(20L)));

        resolver.resolve(candidate(10L, List.of()));

        ArgumentCaptor<java.util.Collection<Long>> userIds = ArgumentCaptor.forClass(java.util.Collection.class);
        verify(registrations).findFreshEnabledByUserIds(userIds.capture(),
                eq(LocalDateTime.of(2026, 6, 30, 8, 15, 30)));
        assertThat(userIds.getValue()).containsExactly(20L);
        verify(memberMapper).selectList(any(Wrapper.class));
        verifyNoMoreInteractions(memberMapper, registrations);
    }

    private PushCandidate candidate(long senderId, List<Long> mentionTargetIds) {
        return new PushCandidate(1, "m_1", "g_100", 86L, senderId, "TEXT", "今晚八点发布", mentionTargetIds, 123L);
    }

    private ImConversationMember member(long userId, boolean muted) {
        ImConversationMember member = new ImConversationMember();
        member.setUserId(userId);
        member.setMuted(muted ? 1 : 0);
        return member;
    }

    private ImPushRegistration registration(long userId) {
        ImPushRegistration registration = new ImPushRegistration();
        registration.setUserId(userId);
        return registration;
    }
}
