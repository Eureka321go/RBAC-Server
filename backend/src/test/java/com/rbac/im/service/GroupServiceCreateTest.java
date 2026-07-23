package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.entity.ImGroupMember;
import com.rbac.im.mapper.ImConversationMemberMapper;
import com.rbac.im.mapper.ImGroupMemberMapper;
import com.rbac.im.vo.CreateGroupResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Limit;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class GroupServiceCreateTest {

    @Autowired GroupService groupService;
    @Autowired ImGroupMemberMapper groupMemberMapper;
    @Autowired ImConversationMemberMapper convMemberMapper;
    @Autowired ImMessageRepository repo;

    @Test
    void createGroup_setsOwner_insertsBothTables_emitsSystem() {
        CreateGroupResult r = groupService.createGroup(1001L, "测试群", List.of(1002L, 1003L));

        assertThat(r.getCid()).isEqualTo("g_" + r.getGroupId());

        List<ImGroupMember> gms = groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()));
        assertThat(gms).hasSize(3);
        assertThat(gms).anyMatch(m -> m.getUserId() == 1001L && "OWNER".equals(m.getRole()));
        assertThat(gms).filteredOn(m -> m.getUserId() != 1001L).allMatch(m -> "MEMBER".equals(m.getRole()));

        List<ImConversationMember> cms = convMemberMapper.selectList(new LambdaQueryWrapper<ImConversationMember>()
                .eq(ImConversationMember::getCid, r.getCid()));
        assertThat(cms).hasSize(3);

        List<ImMessage> msgs = repo.findByCidAndSeqGreaterThanOrderBySeqAsc(r.getCid(), 0L, Limit.of(10));
        assertThat(msgs).hasSize(1);
        assertThat(msgs.get(0).getType()).isEqualTo("SYSTEM");
        assertThat(msgs.get(0).getBody().get("event")).isEqualTo("GROUP_CREATE");
    }

    @Test
    void createGroup_dedupesOwnerInMemberIds() {
        CreateGroupResult r = groupService.createGroup(2001L, "去重群", List.of(2001L, 2002L, 2002L));
        List<ImGroupMember> gms = groupMemberMapper.selectList(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, r.getGroupId()));
        assertThat(gms).hasSize(2);   // 2001(owner) + 2002
    }
}
