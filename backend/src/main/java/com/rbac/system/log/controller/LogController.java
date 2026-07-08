package com.rbac.system.log.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.system.log.dto.LoginLogQuery;
import com.rbac.system.log.dto.OperationLogQuery;
import com.rbac.system.log.service.LogService;
import com.rbac.system.log.vo.LoginLogVO;
import com.rbac.system.log.vo.OperationLogVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/system")
public class LogController {

    private final LogService logService;

    public LogController(LogService logService) {
        this.logService = logService;
    }

    @GetMapping("/login-logs")
    @PreAuthorize("hasAuthority('system:login-log:list')")
    public Result<PageResult<LoginLogVO>> loginLogs(LoginLogQuery query) {
        return Result.success(logService.pageLoginLogs(query));
    }

    @GetMapping("/operation-logs")
    @PreAuthorize("hasAuthority('system:operation-log:list')")
    public Result<PageResult<OperationLogVO>> operationLogs(OperationLogQuery query) {
        return Result.success(logService.pageOperationLogs(query));
    }
}
