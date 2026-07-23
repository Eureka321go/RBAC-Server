package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class GroupServiceMuteTest {

    @Autowired GroupService groupService;
    @Autowired ConversationService conversationService;

    @Test
    void ownerMutesMember_thenUnmute() {
        CreateGroupResult r = groupService.createGroup(6001L, "群", List.of(6002L));
        groupService.setMute(6001L, r.getGroupId(), 6002L, true);
        assertThat(conversationService.isGroupMuted(r.getCid(), 6002L)).isTrue();

        groupService.setMute(6001L, r.getGroupId(), 6002L, false);
        assertThat(conversationService.isGroupMuted(r.getCid(), 6002L)).isFalse();
    }

    @Test
    void memberCannotMute() {
        CreateGroupResult r = groupService.createGroup(6101L, "群", List.of(6102L, 6103L));
        assertThatThrownBy(() -> groupService.setMute(6102L, r.getGroupId(), 6103L, true))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void cannotMuteAdminOrOwner() {
        CreateGroupResult r = groupService.createGroup(6201L, "群", List.of(6202L));
        groupService.setRole(6201L, r.getGroupId(), 6202L, "ADMIN");
        assertThatThrownBy(() -> groupService.setMute(6201L, r.getGroupId(), 6202L, true))
                .isInstanceOf(BusinessException.class);
    }
}
