package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.service.ConversationService;
import com.rbac.im.vo.ImConversationVO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** IM 会话列表同步。 */
@RestController
@RequestMapping("/im")
public class ImConversationController {

    private final ConversationService conversationService;

    public ImConversationController(ConversationService conversationService) {
        this.conversationService = conversationService;
    }

    @GetMapping("/conversations")
    public Result<List<ImConversationVO>> conversations() {
        return Result.success(conversationService.listMyConversations(SecurityUtils.getUserId()));
    }
}
