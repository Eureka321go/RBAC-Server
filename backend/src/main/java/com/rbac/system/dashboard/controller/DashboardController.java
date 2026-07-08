package com.rbac.system.dashboard.controller;

import com.rbac.common.Result;
import com.rbac.system.dashboard.service.DashboardService;
import com.rbac.system.dashboard.vo.DashboardStatsVO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 首页概览。任意登录用户可见，仅返回聚合总数，不涉及敏感明细。 */
@RestController
@RequestMapping("/system/dashboard")
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping("/stats")
    public Result<DashboardStatsVO> stats() {
        return Result.success(dashboardService.stats());
    }
}
