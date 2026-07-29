package com.rbac.workflow.definition.controller;

import com.rbac.common.Result;
import com.rbac.workflow.definition.service.DefinitionOptionService;
import com.rbac.workflow.definition.vo.DefinitionOptionVO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 发起审批所需的已启用流程选项，仅要求登录态。 */
@RestController
@RequestMapping("/workflow/definition")
public class DefinitionOptionController {

    private final DefinitionOptionService optionService;

    public DefinitionOptionController(DefinitionOptionService optionService) {
        this.optionService = optionService;
    }

    @GetMapping("/options")
    public Result<List<DefinitionOptionVO>> options() {
        return Result.success(optionService.listEnabled());
    }
}
