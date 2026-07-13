package com.rbac.workflow.instance.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.system.log.annotation.Log;
import com.rbac.workflow.instance.dto.InstanceQuery;
import com.rbac.workflow.instance.dto.InstanceStartRequest;
import com.rbac.workflow.instance.service.InstanceService;
import com.rbac.workflow.instance.vo.InstanceDetailVO;
import com.rbac.workflow.instance.vo.InstanceVO;
import com.rbac.workflow.task.dto.CommentRequest;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 流程实例业务端接口。发起需 {@code workflow:instance:start} 权限码；
 * 撤回/我发起的/详情为登录态可用，由 Service 层做本人/参与人校验（安全红线）。
 */
@RestController
@RequestMapping("/workflow/instance")
public class InstanceController {

    private final InstanceService instanceService;

    public InstanceController(InstanceService instanceService) {
        this.instanceService = instanceService;
    }

    @PostMapping("/start")
    @PreAuthorize("hasAuthority('workflow:instance:start')")
    @Log(title = "发起审批", businessType = "CREATE")
    public Result<Long> start(@Valid @RequestBody InstanceStartRequest request) {
        return Result.success(instanceService.start(request));
    }

    @PostMapping("/{id}/withdraw")
    @Log(title = "撤回审批", businessType = "UPDATE")
    public Result<Void> withdraw(@PathVariable Long id, @Valid @RequestBody CommentRequest request) {
        instanceService.withdraw(id, request.getComment());
        return Result.success();
    }

    @GetMapping("/mine")
    public Result<PageResult<InstanceVO>> mine(InstanceQuery query) {
        return Result.success(instanceService.mine(query));
    }

    @GetMapping("/{id}/detail")
    public Result<InstanceDetailVO> detail(@PathVariable Long id) {
        return Result.success(instanceService.detail(id));
    }
}
