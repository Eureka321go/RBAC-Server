package com.rbac.im.mapper;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.entity.ImGroupMember;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class ImGroupMemberMutedTest {

    @Autowired ImGroupMemberMapper mapper;
    @Autowired JdbcTemplate jdbc;

    @Test
    void muted_roundTrip() {
        // Clean up before test to ensure repeatability
        jdbc.update("delete from im_group_member where group_id = ? and user_id = ?", 770001L, 880001L);

        ImGroupMember m = new ImGroupMember();
        m.setGroupId(770001L);
        m.setUserId(880001L);
        m.setRole("MEMBER");
        m.setMuted(1);
        mapper.insert(m);

        ImGroupMember loaded = mapper.selectOne(new LambdaQueryWrapper<ImGroupMember>()
                .eq(ImGroupMember::getGroupId, 770001L)
                .eq(ImGroupMember::getUserId, 880001L));
        assertThat(loaded.getMuted()).isEqualTo(1);

        // Physical delete for repeatability
        jdbc.update("delete from im_group_member where group_id = ? and user_id = ?", 770001L, 880001L);
    }
}
