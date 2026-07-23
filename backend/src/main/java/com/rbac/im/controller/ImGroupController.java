package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.dto.CreateGroupRequest;
import com.rbac.im.service.GroupService;
import com.rbac.im.vo.CreateGroupResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** IM 群管理。 */
@RestController
@RequestMapping("/im/groups")
public class ImGroupController {

    private final GroupService groupService;

    public ImGroupController(GroupService groupService) {
        this.groupService = groupService;
    }

    @PostMapping
    public Result<CreateGroupResult> create(@RequestBody CreateGroupRequest req) {
        return Result.success(groupService.createGroup(SecurityUtils.getUserId(), req.getName(), req.getMemberIds()));
    }
}
