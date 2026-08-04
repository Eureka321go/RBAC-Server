package com.rbac.im.push.delivery;

import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.push.candidate.PushCandidate;
import com.rbac.im.push.registration.ImPushRegistration;
import com.rbac.im.push.registration.PushRegistrationService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

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
import static org.mockito.Mockito.when;

class PushRecipientResolverSpringContextTest {

    @Test
    void contextCreatesResolverWithFallbackClock() {
        try (AnnotationConfigApplicationContext context = context(null, mock(ImConversationMemberMapper.class),
                mock(PushRegistrationService.class))) {
            assertThat(context.getBean(PushRecipientResolver.class)).isNotNull();
            assertThat(context.getBean(Clock.class)).isNotNull();
        }
    }

    @Test
    void contextInjectsOverriddenClockIntoResolver() {
        Clock clock = Clock.fixed(Instant.parse("2026-07-30T08:15:30Z"), ZoneOffset.UTC);
        ImConversationMemberMapper memberMapper = mock(ImConversationMemberMapper.class);
        PushRegistrationService registrations = mock(PushRegistrationService.class);
        ImConversationMember member = new ImConversationMember();
        member.setUserId(20L);
        member.setMuted(0);
        ImPushRegistration registration = new ImPushRegistration();
        registration.setUserId(20L);
        when(memberMapper.selectList(any())).thenReturn(List.of(member));
        when(registrations.findFreshEnabledByUserIds(any(), any())).thenReturn(List.of(registration));

        try (AnnotationConfigApplicationContext context = context(clock, memberMapper, registrations)) {
            context.getBean(PushRecipientResolver.class).resolve(candidate());

            ArgumentCaptor<java.util.Collection<Long>> userIds = ArgumentCaptor.forClass(java.util.Collection.class);
            verify(registrations).findFreshEnabledByUserIds(userIds.capture(),
                    eq(LocalDateTime.of(2026, 6, 30, 8, 15, 30)));
            assertThat(userIds.getValue()).containsExactly(20L);
            assertThat(context.getBean(Clock.class)).isSameAs(clock);
        }
    }

    private AnnotationConfigApplicationContext context(Clock clock,
                                                        ImConversationMemberMapper memberMapper,
                                                        PushRegistrationService registrations) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(PushDeliveryConfiguration.class, PushRecipientResolver.class);
        context.registerBean(ImConversationMemberMapper.class, () -> memberMapper);
        context.registerBean(PushRegistrationService.class, () -> registrations);
        if (clock != null) {
            context.registerBean(Clock.class, () -> clock);
        }
        context.refresh();
        return context;
    }

    private PushCandidate candidate() {
        return new PushCandidate(1, "m_1", "g_100", 86L, 10L, "TEXT", "预览", List.of(), 123L);
    }
}
