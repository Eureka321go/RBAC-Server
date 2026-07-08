package com.rbac.system.user.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.common.domain.StatusUpdateRequest;
import com.rbac.system.user.dto.AssignRolesRequest;
import com.rbac.system.user.dto.PasswordResetRequest;
import com.rbac.system.user.dto.UserCreateRequest;
import com.rbac.system.user.dto.UserQuery;
import com.rbac.system.user.dto.UserUpdateRequest;
import com.rbac.system.user.service.UserService;
import com.rbac.system.user.vo.UserVO;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/system/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('system:user:list')")
    public Result<PageResult<UserVO>> page(UserQuery query) {
        return Result.success(userService.page(query));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('system:user:list')")
    public Result<UserVO> detail(@PathVariable Long id) {
        return Result.success(userService.getById(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:user:add')")
    public Result<Long> create(@Valid @RequestBody UserCreateRequest request) {
        return Result.success(userService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:user:edit')")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody UserUpdateRequest request) {
        userService.update(id, request);
        return Result.success();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:user:delete')")
    public Result<Void> delete(@PathVariable Long id) {
        userService.delete(id);
        return Result.success();
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAuthority('system:user:edit')")
    public Result<Void> updateStatus(@PathVariable Long id, @Valid @RequestBody StatusUpdateRequest request) {
        userService.updateStatus(id, request.getStatus());
        return Result.success();
    }

    @PatchMapping("/{id}/password")
    @PreAuthorize("hasAuthority('system:user:reset-password')")
    public Result<Void> resetPassword(@PathVariable Long id, @Valid @RequestBody PasswordResetRequest request) {
        userService.resetPassword(id, request.getPassword());
        return Result.success();
    }

    @PutMapping("/{id}/roles")
    @PreAuthorize("hasAuthority('system:user:assign-role')")
    public Result<Void> assignRoles(@PathVariable Long id, @RequestBody AssignRolesRequest request) {
        userService.assignRoles(id, request.getRoleIds());
        return Result.success();
    }
}
