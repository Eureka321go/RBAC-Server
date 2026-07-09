package com.rbac.common.domain;

import lombok.Data;

/**
 * 统一分页请求。page 从 1 开始。
 */
@Data
public class PageRequest {

    private Integer page = 1;

    private Integer pageSize = 20;

    public long current() {
        return page == null || page < 1 ? 1 : page;
    }

    public long size() {
        if (pageSize == null || pageSize < 1) {
            return 20;
        }
        return Math.min(pageSize, 200);
    }
}
