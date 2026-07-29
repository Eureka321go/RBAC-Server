package com.rbac.im.service;

import com.rbac.im.mapper.ImConversationMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 里程碑9：@提及 解析与校验（纯单测，mock 协作者）。 */
class MentionServiceTest {

    private static final String GROUP = "g_100";
    private static final String SINGLE = "c_10_20";
    private static final long SENDER = 10L;

    private ConversationService conversationService;
    private GroupService groupService;
    private ImConversationMemberMapper memberMapper;

    @BeforeEach
    void setUp() {
        conversationService = mock(ConversationService.class);
        groupService = mock(GroupService.class);
        memberMapper = mock(ImConversationMemberMapper.class);
    }

    private MentionService service(boolean adminOnly) {
        return new MentionService(conversationService, groupService, memberMapper, adminOnly);
    }

    private static Map<String, Object> textBody(Map<String, Object> extra) {
        Map<String, Object> b = new java.util.HashMap<>();
        b.put("text", "hi");
        b.putAll(extra);
        return b;
    }

    @Test
    void group_mentionAll_by_manager_targets_all_except_sender() {
        when(groupService.isGroupManager(100L, SENDER)).thenReturn(true);
        when(conversationService.memberUserIds(GROUP)).thenReturn(List.of(10L, 20L, 30L));

        List<Long> targets = service(true).resolve(GROUP, SENDER, "TEXT",
                textBody(Map.of("mentionAll", true)));

        assertEquals(List.of(20L, 30L), targets.stream().sorted().toList());
    }

    @Test
    void group_mentionAll_by_member_forbidden_when_adminOnly() {
        when(groupService.isGroupManager(100L, SENDER)).thenReturn(false);

        MentionValidationException ex = assertThrows(MentionValidationException.class,
                () -> service(true).resolve(GROUP, SENDER, "TEXT", textBody(Map.of("mentionAll", true))));
        assertEquals("MENTION_ALL_FORBIDDEN", ex.getReason());
    }

    @Test
    void group_mentionAll_by_member_allowed_when_not_adminOnly() {
        when(conversationService.memberUserIds(GROUP)).thenReturn(List.of(10L, 20L));

        List<Long> targets = service(false).resolve(GROUP, SENDER, "TEXT",
                textBody(Map.of("mentionAll", true)));

        assertEquals(List.of(20L), targets);
    }

    @Test
    void group_mentions_members_returns_list_minus_sender_deduped() {
        when(conversationService.isMember(GROUP, 20L)).thenReturn(true);
        when(conversationService.isMember(GROUP, 30L)).thenReturn(true);
        when(conversationService.isMember(GROUP, 10L)).thenReturn(true);

        List<Long> targets = service(true).resolve(GROUP, SENDER, "TEXT",
                textBody(Map.of("mentions", List.of(20, 30, 20, 10)))); // 含重复 + 含 sender 自己

        assertEquals(List.of(20L, 30L), targets.stream().sorted().toList());
    }

    @Test
    void group_mentions_with_non_member_rejected() {
        when(conversationService.isMember(GROUP, 20L)).thenReturn(true);
        when(conversationService.isMember(GROUP, 999L)).thenReturn(false);

        MentionValidationException ex = assertThrows(MentionValidationException.class,
                () -> service(true).resolve(GROUP, SENDER, "TEXT",
                        textBody(Map.of("mentions", List.of(20, 999)))));
        assertEquals("MENTION_NOT_MEMBER", ex.getReason());
    }

    @Test
    void mentionAll_takes_priority_over_mentions() {
        when(groupService.isGroupManager(100L, SENDER)).thenReturn(true);
        when(conversationService.memberUserIds(GROUP)).thenReturn(List.of(10L, 20L, 30L));

        List<Long> targets = service(true).resolve(GROUP, SENDER, "TEXT",
                textBody(Map.of("mentionAll", true, "mentions", List.of(20))));

        assertEquals(List.of(20L, 30L), targets.stream().sorted().toList());
    }

    @Test
    void single_chat_mentions_ignored() {
        List<Long> targets = service(true).resolve(SINGLE, SENDER, "TEXT",
                textBody(Map.of("mentions", List.of(20), "mentionAll", true)));
        assertTrue(targets.isEmpty());
    }

    @Test
    void non_text_returns_empty() {
        List<Long> targets = service(true).resolve(GROUP, SENDER, "IMAGE",
                Map.of("mentionAll", true));
        assertTrue(targets.isEmpty());
    }

    @Test
    void null_body_returns_empty() {
        assertTrue(service(true).resolve(GROUP, SENDER, "TEXT", null).isEmpty());
    }

    @Test
    void only_self_mention_returns_empty() {
        when(conversationService.isMember(GROUP, 10L)).thenReturn(true);
        List<Long> targets = service(true).resolve(GROUP, SENDER, "TEXT",
                textBody(Map.of("mentions", List.of(10))));
        assertTrue(targets.isEmpty());
    }

    @Test
    void plain_text_without_mentions_returns_empty() {
        assertTrue(service(true).resolve(GROUP, SENDER, "TEXT", Map.of("text", "hi")).isEmpty());
    }

    @Test
    void apply_empty_targets_skips_mapper() {
        service(true).apply(GROUP, 5L, List.of());
        service(true).apply(GROUP, 5L, null);
        org.mockito.Mockito.verify(memberMapper, org.mockito.Mockito.never())
                .advanceMentionSeq(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.anyList(),
                        org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void apply_non_empty_targets_forwards_to_mapper() {
        service(true).apply(GROUP, 42L, List.of(20L, 30L));
        org.mockito.Mockito.verify(memberMapper).advanceMentionSeq(GROUP, List.of(20L, 30L), 42L);
    }
}
