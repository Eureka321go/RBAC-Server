package com.rbac.system.dashboard.vo;

import lombok.Data;

/** 首页概览统计。 */
@Data
public class DashboardStatsVO {

    /** 系统用户总数（在管账户）。 */
    private long userCount;

    /** 角色总数（权限分组）。 */
    private long roleCount;

    /** 菜单资源总数（可控功能点）。 */
    private long menuCount;

    /** 部门机构总数（组织架构）。 */
    private long deptCount;
}
