package com.rbac.system.role.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.common.domain.StatusUpdateRequest;
import com.rbac.system.role.dto.GrantMenuRequest;
import com.rbac.system.role.dto.RoleQuery;
import com.rbac.system.role.dto.RoleSaveRequest;
import com.rbac.system.role.service.RoleService;
import com.rbac.system.role.vo.RoleVO;
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

import java.util.List;

@RestController
@RequestMapping("/system/roles")
public class RoleController {

    private final RoleService roleService;

    public RoleController(RoleService roleService) {
        this.roleService = roleService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('system:role:list')")
    public Result<PageResult<RoleVO>> page(RoleQuery query) {
        return Result.success(roleService.page(query));
    }

    /** 全部启用角色，供用户分配角色下拉使用。 */
    @GetMapping("/options")
    @PreAuthorize("hasAuthority('system:role:list')")
    public Result<List<RoleVO>> options() {
        return Result.success(roleService.listAllEnabled());
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('system:role:list')")
    public Result<RoleVO> detail(@PathVariable Long id) {
        return Result.success(RoleVO.from(roleService.getById(id)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:role:add')")
    public Result<Long> create(@Valid @RequestBody RoleSaveRequest request) {
        return Result.success(roleService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:role:edit')")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody RoleSaveRequest request) {
        roleService.update(id, request);
        return Result.success();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:role:delete')")
    public Result<Void> delete(@PathVariable Long id) {
        roleService.delete(id);
        return Result.success();
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAuthority('system:role:edit')")
    public Result<Void> updateStatus(@PathVariable Long id, @Valid @RequestBody StatusUpdateRequest request) {
        roleService.updateStatus(id, request.getStatus());
        return Result.success();
    }

    @GetMapping("/{id}/menus")
    @PreAuthorize("hasAuthority('system:role:grant-menu')")
    public Result<List<Long>> menuIds(@PathVariable Long id) {
        return Result.success(roleService.getMenuIds(id));
    }

    @PutMapping("/{id}/menus")
    @PreAuthorize("hasAuthority('system:role:grant-menu')")
    public Result<Void> grantMenus(@PathVariable Long id, @RequestBody GrantMenuRequest request) {
        roleService.grantMenus(id, request.getMenuIds());
        return Result.success();
    }
}
