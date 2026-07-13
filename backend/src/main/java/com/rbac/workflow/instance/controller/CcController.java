package com.rbac.workflow.instance.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.workflow.instance.dto.InstanceQuery;
import com.rbac.workflow.instance.service.InstanceService;
import com.rbac.workflow.instance.vo.CcVO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 抄送接口。仅登录态，按当前用户过滤（数据权限不可绕过）。
 */
@RestController
@RequestMapping("/workflow/cc")
public class CcController {

    private final InstanceService instanceService;

    public CcController(InstanceService instanceService) {
        this.instanceService = instanceService;
    }

    @GetMapping("/mine")
    public Result<PageResult<CcVO>> mine(InstanceQuery query) {
        return Result.success(instanceService.ccMine(query));
    }

    @PostMapping("/{id}/read")
    public Result<Void> read(@PathVariable Long id) {
        instanceService.readCc(id);
        return Result.success();
    }
}
