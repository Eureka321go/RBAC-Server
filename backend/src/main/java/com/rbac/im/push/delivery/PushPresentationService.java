package com.rbac.im.push.delivery;

import com.rbac.im.entity.ImGroup;
import com.rbac.im.mapper.ImGroupMapper;
import com.rbac.im.push.candidate.PushCandidate;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import org.springframework.stereotype.Service;

@Service
public class PushPresentationService {

    private final SysUserMapper userMapper;
    private final ImGroupMapper groupMapper;

    public PushPresentationService(SysUserMapper userMapper, ImGroupMapper groupMapper) {
        this.userMapper = userMapper;
        this.groupMapper = groupMapper;
    }

    public PushPresentation resolve(PushCandidate candidate) {
        String senderName = senderName(candidate.senderId());
        if (!candidate.cid().startsWith("g_")) {
            return new PushPresentation(senderName, senderName);
        }
        long groupId = Long.parseLong(candidate.cid().substring(2));
        ImGroup group = groupMapper.selectById(groupId);
        String title = group == null ? null : group.getName();
        if (title == null || title.isBlank()) {
            title = "群聊 #" + groupId;
        }
        return new PushPresentation(title, senderName);
    }

    private String senderName(long senderId) {
        SysUser sender = userMapper.selectById(senderId);
        if (sender != null && sender.getNickname() != null && !sender.getNickname().isBlank()) {
            return sender.getNickname();
        }
        if (sender != null && sender.getUsername() != null && !sender.getUsername().isBlank()) {
            return sender.getUsername();
        }
        return "用户 #" + senderId;
    }
}
