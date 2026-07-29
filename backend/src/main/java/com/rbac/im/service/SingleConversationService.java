package com.rbac.im.service;

import com.rbac.common.exception.BusinessException;
import com.rbac.im.vo.CreateSingleConversationResult;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import org.springframework.stereotype.Service;

/** 单聊创建入口：验证对端用户后，幂等建立会话及双方成员关系。 */
@Service
public class SingleConversationService {

    private final ConversationService conversationService;
    private final SysUserMapper userMapper;

    public SingleConversationService(ConversationService conversationService,
                                     SysUserMapper userMapper) {
        this.conversationService = conversationService;
        this.userMapper = userMapper;
    }

    public CreateSingleConversationResult create(long currentUserId, long peerId) {
        if (currentUserId == peerId) {
            throw new BusinessException(400, "im.single.cannotChatSelf");
        }
        SysUser peer = userMapper.selectById(peerId);
        if (peer == null) {
            throw new BusinessException(404, "user.notFound");
        }
        if (!"ENABLED".equals(peer.getStatus())) {
            throw new BusinessException(400, "im.single.peerDisabled");
        }
        return new CreateSingleConversationResult(
                conversationService.ensureSingleConversation(currentUserId, peerId));
    }
}
