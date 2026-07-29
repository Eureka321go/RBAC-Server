package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.vo.CreateGroupResult;
import com.rbac.im.vo.ImGroupMemberVO;
import com.rbac.im.vo.ImGroupVO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class GroupServiceQueryTest {

    @Autowired GroupService groupService;
    @Autowired ImConversationMapper conversationMapper;
    @Autowired ImMessageRepository repo;

    @Test
    void getGroup_forMember() {
        CreateGroupResult r = groupService.createGroup(7001L, "群Q", List.of(7002L));
        ImGroupVO vo = groupService.getGroup(r.getGroupId(), 7001L);
        assertThat(vo.getName()).isEqualTo("群Q");
        assertThat(vo.getOwnerId()).isEqualTo(7001L);
        assertThat(vo.getMemberCount()).isEqualTo(2);
        assertThat(vo.getMyRole()).isEqualTo("OWNER");
    }

    @Test
    void getGroup_nonMember_403() {
        CreateGroupResult r = groupService.createGroup(7101L, "群", List.of(7102L));
        assertThatThrownBy(() -> groupService.getGroup(r.getGroupId(), 9999L))
                .isInstanceOf(BusinessException.class)
                .hasFieldOrPropertyWithValue("code", 403);
    }

    @Test
    void listMembers_returnsRolesAndMute() {
        CreateGroupResult r = groupService.createGroup(7201L, "群", List.of(7202L));
        groupService.setMute(7201L, r.getGroupId(), 7202L, true);
        List<ImGroupMemberVO> members = groupService.listMembers(r.getGroupId(), 7201L);
        assertThat(members).hasSize(2);
        assertThat(members).anyMatch(m -> m.getUserId() == 7202L && m.isMuted());
    }

    @Test
    void dissolve_emitsSystem_thenSoftDeletes() {
        CreateGroupResult r = groupService.createGroup(7301L, "群", List.of(7302L));
        groupService.dissolve(7301L, r.getGroupId());

        // 解散前发出了 GROUP_DISSOLVE（在软删前扇出并落库）
        List<ImMessage> msgs = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(r.getCid(), 0L, Limit.of(20));
        assertThat(msgs).anyMatch(m -> "SYSTEM".equals(m.getType()) && "GROUP_DISSOLVE".equals(m.getBody().get("event")));

        // 会话已软删（selectOne 查不到 deleted=0 的行）
        ImConversation c = conversationMapper.selectOne(new LambdaQueryWrapper<ImConversation>()
                .eq(ImConversation::getCid, r.getCid()));
        assertThat(c).isNull();

        // 非成员（已解散）再操作报错
        assertThatThrownBy(() -> groupService.getGroup(r.getGroupId(), 7301L))
                .isInstanceOf(BusinessException.class);
    }
}
