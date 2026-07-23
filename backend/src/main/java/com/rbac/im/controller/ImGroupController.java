package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.dto.AddMembersRequest;
import com.rbac.im.dto.CreateGroupRequest;
import com.rbac.im.dto.RenameRequest;
import com.rbac.im.dto.SetMuteRequest;
import com.rbac.im.dto.SetRoleRequest;
import com.rbac.im.dto.TransferRequest;
import com.rbac.im.service.GroupService;
import com.rbac.im.vo.CreateGroupResult;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
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

    @PostMapping("/{groupId}/members")
    public Result<Void> addMembers(@PathVariable Long groupId, @RequestBody AddMembersRequest req) {
        groupService.addMembers(SecurityUtils.getUserId(), groupId, req.getUserIds());
        return Result.success();
    }

    @DeleteMapping("/{groupId}/members/me")
    public Result<Void> leave(@PathVariable Long groupId) {
        groupService.leaveGroup(SecurityUtils.getUserId(), groupId);
        return Result.success();
    }

    @DeleteMapping("/{groupId}/members/{userId}")
    public Result<Void> kick(@PathVariable Long groupId, @PathVariable Long userId) {
        groupService.removeMember(SecurityUtils.getUserId(), groupId, userId);
        return Result.success();
    }

    @PatchMapping("/{groupId}")
    public Result<Void> rename(@PathVariable Long groupId, @RequestBody RenameRequest req) {
        groupService.rename(SecurityUtils.getUserId(), groupId, req.getName());
        return Result.success();
    }

    @PostMapping("/{groupId}/owner")
    public Result<Void> transfer(@PathVariable Long groupId, @RequestBody TransferRequest req) {
        groupService.transferOwner(SecurityUtils.getUserId(), groupId, req.getNewOwnerId());
        return Result.success();
    }

    @PutMapping("/{groupId}/members/{userId}/role")
    public Result<Void> setRole(@PathVariable Long groupId, @PathVariable Long userId, @RequestBody SetRoleRequest req) {
        groupService.setRole(SecurityUtils.getUserId(), groupId, userId, req.getRole());
        return Result.success();
    }

    @PutMapping("/{groupId}/members/{userId}/mute")
    public Result<Void> setMute(@PathVariable Long groupId, @PathVariable Long userId, @RequestBody SetMuteRequest req) {
        groupService.setMute(SecurityUtils.getUserId(), groupId, userId, Boolean.TRUE.equals(req.getMuted()));
        return Result.success();
    }
}
