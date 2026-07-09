package com.rbac.system.dept.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.StatusUpdateRequest;
import com.rbac.system.dept.dto.DeptSaveRequest;
import com.rbac.system.dept.service.DeptService;
import com.rbac.system.dept.vo.DeptVO;
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
@RequestMapping("/system/depts")
public class DeptController {

    private final DeptService deptService;

    public DeptController(DeptService deptService) {
        this.deptService = deptService;
    }

    @GetMapping("/tree")
    @PreAuthorize("hasAuthority('system:dept:list')")
    public Result<List<DeptVO>> tree() {
        return Result.success(deptService.tree());
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('system:dept:list')")
    public Result<DeptVO> detail(@PathVariable Long id) {
        return Result.success(DeptVO.from(deptService.getById(id)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:dept:add')")
    public Result<Long> create(@Valid @RequestBody DeptSaveRequest request) {
        return Result.success(deptService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:dept:edit')")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody DeptSaveRequest request) {
        deptService.update(id, request);
        return Result.success();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:dept:delete')")
    public Result<Void> delete(@PathVariable Long id) {
        deptService.delete(id);
        return Result.success();
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAuthority('system:dept:edit')")
    public Result<Void> updateStatus(@PathVariable Long id, @Valid @RequestBody StatusUpdateRequest request) {
        deptService.updateStatus(id, request.getStatus());
        return Result.success();
    }
}
