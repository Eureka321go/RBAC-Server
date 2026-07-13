package com.rbac.workflow.task.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.system.log.annotation.Log;
import com.rbac.workflow.task.dto.CommentRequest;
import com.rbac.workflow.task.dto.TaskQuery;
import com.rbac.workflow.task.dto.TransferRequest;
import com.rbac.workflow.task.service.TaskService;
import com.rbac.workflow.task.vo.TaskVO;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 审批任务业务端接口。审批动作不设静态权限码，由 Service/引擎二次校验合法审批人（安全红线）。
 */
@RestController
@RequestMapping("/workflow/task")
public class TaskController {

    private final TaskService taskService;

    public TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    @GetMapping("/todo")
    public Result<PageResult<TaskVO>> todo(TaskQuery query) {
        return Result.success(taskService.todo(query));
    }

    @GetMapping("/done")
    public Result<PageResult<TaskVO>> done(TaskQuery query) {
        return Result.success(taskService.done(query));
    }

    @PostMapping("/{id}/approve")
    @Log(title = "审批同意", businessType = "APPROVE")
    public Result<Void> approve(@PathVariable Long id, @Valid @RequestBody CommentRequest request) {
        taskService.approve(id, request.getComment());
        return Result.success();
    }

    @PostMapping("/{id}/reject")
    @Log(title = "审批驳回", businessType = "REJECT")
    public Result<Void> reject(@PathVariable Long id, @Valid @RequestBody CommentRequest request) {
        taskService.reject(id, request.getComment());
        return Result.success();
    }

    @PostMapping("/{id}/transfer")
    @Log(title = "审批转办", businessType = "TRANSFER")
    public Result<Void> transfer(@PathVariable Long id, @Valid @RequestBody TransferRequest request) {
        taskService.transfer(id, request.getTargetUserId(), request.getComment());
        return Result.success();
    }
}
