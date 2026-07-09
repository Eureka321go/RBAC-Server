package com.rbac.system.menu.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.StatusUpdateRequest;
import com.rbac.system.menu.dto.MenuSaveRequest;
import com.rbac.system.menu.service.MenuService;
import com.rbac.system.menu.vo.MenuVO;
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
@RequestMapping("/system/menus")
public class MenuController {

    private final MenuService menuService;

    public MenuController(MenuService menuService) {
        this.menuService = menuService;
    }

    @GetMapping("/tree")
    @PreAuthorize("hasAuthority('system:menu:list')")
    public Result<List<MenuVO>> tree() {
        return Result.success(menuService.tree());
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('system:menu:list')")
    public Result<MenuVO> detail(@PathVariable Long id) {
        return Result.success(MenuVO.from(menuService.getById(id)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:menu:add')")
    public Result<Long> create(@Valid @RequestBody MenuSaveRequest request) {
        return Result.success(menuService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:menu:edit')")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody MenuSaveRequest request) {
        menuService.update(id, request);
        return Result.success();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:menu:delete')")
    public Result<Void> delete(@PathVariable Long id) {
        menuService.delete(id);
        return Result.success();
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAuthority('system:menu:edit')")
    public Result<Void> updateStatus(@PathVariable Long id, @Valid @RequestBody StatusUpdateRequest request) {
        menuService.updateStatus(id, request.getStatus());
        return Result.success();
    }
}
