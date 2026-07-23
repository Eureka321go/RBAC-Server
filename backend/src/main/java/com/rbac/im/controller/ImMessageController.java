package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.service.MessageQueryService;
import com.rbac.im.vo.PullResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** IM 单会话增量拉取。 */
@RestController
@RequestMapping("/im")
public class ImMessageController {

    private final MessageQueryService messageQueryService;

    public ImMessageController(MessageQueryService messageQueryService) {
        this.messageQueryService = messageQueryService;
    }

    @GetMapping("/messages")
    public Result<PullResult> messages(@RequestParam String cid,
                                       @RequestParam(required = false) Long sinceSeq,
                                       @RequestParam(required = false) Integer limit) {
        return Result.success(messageQueryService.pull(cid, sinceSeq, limit, SecurityUtils.getUserId()));
    }
}
