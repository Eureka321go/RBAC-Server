package com.rbac.common.domain;

import com.baomidou.mybatisplus.core.metadata.IPage;
import lombok.Data;

import java.io.Serializable;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 统一分页响应。
 *
 * @param <T> 记录类型
 */
@Data
public class PageResult<T> implements Serializable {

    private List<T> records;
    private long total;
    private long page;
    private long pageSize;

    public static <T> PageResult<T> of(List<T> records, long total, long page, long pageSize) {
        PageResult<T> r = new PageResult<>();
        r.setRecords(records);
        r.setTotal(total);
        r.setPage(page);
        r.setPageSize(pageSize);
        return r;
    }

    /**
     * 从 MyBatis-Plus 分页对象构造，并将实体映射为 VO。
     */
    public static <E, T> PageResult<T> from(IPage<E> page, Function<E, T> mapper) {
        List<T> records = page.getRecords().stream().map(mapper).collect(Collectors.toList());
        return of(records, page.getTotal(), page.getCurrent(), page.getSize());
    }
}
