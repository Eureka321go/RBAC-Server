package com.rbac.workflow.definition.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.common.domain.StatusUpdateRequest;
import com.rbac.system.log.annotation.Log;
import com.rbac.workflow.definition.dto.DefinitionQuery;
import com.rbac.workflow.definition.dto.DefinitionSaveRequest;
import com.rbac.workflow.definition.service.DefinitionService;
import com.rbac.workflow.definition.vo.DefinitionVO;
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

/**
 * 流程定义管理端接口（`workflow:definition:*` 权限码控制）。
 */
@RestController
@RequestMapping("/workflow/definition")
public class DefinitionController {

    private final DefinitionService definitionService;

    public DefinitionController(DefinitionService definitionService) {
        this.definitionService = definitionService;
    }

    @GetMapping("/page")
    @PreAuthorize("hasAuthority('workflow:definition:list')")
    public Result<PageResult<DefinitionVO>> page(DefinitionQuery query) {
        return Result.success(definitionService.page(query));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('workflow:definition:query')")
    public Result<DefinitionVO> detail(@PathVariable Long id) {
        return Result.success(definitionService.detail(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('workflow:definition:add')")
    @Log(title = "流程定义", businessType = "CREATE")
    public Result<Long> create(@Valid @RequestBody DefinitionSaveRequest request) {
        return Result.success(definitionService.create(request));
    }

    @PutMapping
    @PreAuthorize("hasAuthority('workflow:definition:edit')")
    @Log(title = "流程定义", businessType = "UPDATE")
    public Result<Long> update(@Valid @RequestBody DefinitionSaveRequest request) {
        return Result.success(definitionService.update(request));
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAuthority('workflow:definition:edit')")
    @Log(title = "流程定义", businessType = "UPDATE")
    public Result<Void> updateStatus(@PathVariable Long id, @Valid @RequestBody StatusUpdateRequest request) {
        definitionService.updateStatus(id, request.getStatus());
        return Result.success();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('workflow:definition:remove')")
    @Log(title = "流程定义", businessType = "DELETE")
    public Result<Void> delete(@PathVariable Long id) {
        definitionService.delete(id);
        return Result.success();
    }
}
