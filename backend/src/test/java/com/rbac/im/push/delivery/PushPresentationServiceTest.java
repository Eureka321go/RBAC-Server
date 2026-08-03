package com.rbac.im.push.delivery;

import com.rbac.im.entity.ImGroup;
import com.rbac.im.mapper.ImGroupMapper;
import com.rbac.im.push.candidate.PushCandidate;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PushPresentationServiceTest {

    private final SysUserMapper userMapper = mock(SysUserMapper.class);
    private final ImGroupMapper groupMapper = mock(ImGroupMapper.class);
    private PushPresentationService service;

    @BeforeEach
    void setUp() {
        service = new PushPresentationService(userMapper, groupMapper);
    }

    @Test
    void resolve_usesGroupNameAndSenderNicknameForGroup() {
        when(userMapper.selectById(42L)).thenReturn(user(42L, "zhangsan", "张三"));
        ImGroup group = new ImGroup();
        group.setName("研发群");
        when(groupMapper.selectById(100L)).thenReturn(group);

        PushPresentation presentation = service.resolve(candidate("g_100", 42L));

        assertThat(presentation).isEqualTo(new PushPresentation("研发群", "张三"));
        verify(userMapper).selectById(42L);
        verify(groupMapper).selectById(100L);
    }

    @Test
    void resolve_usesUsernameThenUserIdAndGroupIdFallbacks() {
        when(userMapper.selectById(42L)).thenReturn(user(42L, "zhangsan", ""));
        ImGroup unnamed = new ImGroup();
        unnamed.setName(" ");
        when(groupMapper.selectById(100L)).thenReturn(unnamed);

        assertThat(service.resolve(candidate("g_100", 42L)))
                .isEqualTo(new PushPresentation("群聊 #100", "zhangsan"));

        when(userMapper.selectById(43L)).thenReturn(user(43L, "", null));
        assertThat(service.resolve(candidate("u_43", 43L)))
                .isEqualTo(new PushPresentation("用户 #43", "用户 #43"));
    }

    @Test
    void resolve_usesSenderNameAsSingleConversationTitle() {
        when(userMapper.selectById(42L)).thenReturn(user(42L, "zhangsan", "张三"));

        assertThat(service.resolve(candidate("u_42", 42L)))
                .isEqualTo(new PushPresentation("张三", "张三"));
    }

    private PushCandidate candidate(String cid, long senderId) {
        return new PushCandidate(1, "m_1", cid, 1L, senderId, "TEXT", "预览", java.util.List.of(), 123L);
    }

    private SysUser user(long id, String username, String nickname) {
        SysUser user = new SysUser();
        user.setId(id);
        user.setUsername(username);
        user.setNickname(nickname);
        return user;
    }
}
