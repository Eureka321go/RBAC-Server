package com.rbac.common.datascope;

import lombok.Data;

import java.util.Set;

/**
 * 数据范围计算结果，供 Service 层构造查询条件：
 * <ul>
 *   <li>{@code all=true}：不加任何数据范围限制（如超管或 ALL 范围）。</li>
 *   <li>{@code deptIds}：允许访问的部门 ID 集合（可为空）。</li>
 *   <li>{@code selfUserId}：非空时，额外放行「本人创建」的数据。</li>
 * </ul>
 */
@Data
public class DataScopeQuery {

    private boolean all;
    private Set<Long> deptIds;
    private Long selfUserId;

    public static DataScopeQuery all() {
        DataScopeQuery q = new DataScopeQuery();
        q.setAll(true);
        return q;
    }

    public boolean hasDeptScope() {
        return deptIds != null && !deptIds.isEmpty();
    }

    public boolean hasSelfScope() {
        return selfUserId != null;
    }
}
