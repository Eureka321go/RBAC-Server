package com.rbac.workflow.support;

import com.rbac.common.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 工作流审批人选项，仅要求登录态，不授予系统用户管理能力。 */
@RestController
@RequestMapping("/workflow/assignee")
public class AssigneeOptionController {

    private final AssigneeOptionService optionService;

    public AssigneeOptionController(AssigneeOptionService optionService) {
        this.optionService = optionService;
    }

    @GetMapping("/users")
    public Result<List<AssigneeUserOptionVO>> users(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer limit) {
        return Result.success(optionService.search(keyword, limit));
    }
}
