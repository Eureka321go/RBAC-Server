package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.dto.CreateSingleConversationRequest;
import com.rbac.im.service.ConversationService;
import com.rbac.im.service.SingleConversationService;
import com.rbac.im.vo.CreateSingleConversationResult;
import com.rbac.im.vo.ImConversationVO;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** IM 会话列表同步。 */
@RestController
@RequestMapping("/im")
public class ImConversationController {

    private final ConversationService conversationService;
    private final SingleConversationService singleConversationService;

    public ImConversationController(ConversationService conversationService,
                                    SingleConversationService singleConversationService) {
        this.conversationService = conversationService;
        this.singleConversationService = singleConversationService;
    }

    @GetMapping("/conversations")
    public Result<List<ImConversationVO>> conversations() {
        return Result.success(conversationService.listMyConversations(SecurityUtils.getUserId()));
    }

    @PostMapping("/conversations/single")
    public Result<CreateSingleConversationResult> createSingle(
            @Valid @RequestBody CreateSingleConversationRequest request) {
        return Result.success(singleConversationService.create(
                SecurityUtils.getUserId(), request.getPeerId()));
    }
}
