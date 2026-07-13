package com.rbac.workflow.support;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.rbac.system.dept.entity.SysDept;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 为转办和指定用户节点提供受限的启用用户搜索。 */
@Service
public class AssigneeOptionService {

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final SysUserMapper userMapper;
    private final SysDeptMapper deptMapper;

    public AssigneeOptionService(SysUserMapper userMapper, SysDeptMapper deptMapper) {
        this.userMapper = userMapper;
        this.deptMapper = deptMapper;
    }

    public List<AssigneeUserOptionVO> search(String keyword, Integer requestedLimit) {
        String normalizedKeyword = keyword == null ? "" : keyword.trim();
        int limit = normalizeLimit(requestedLimit);
        List<SysUser> users = userMapper.selectList(Wrappers.<SysUser>lambdaQuery()
                .eq(SysUser::getStatus, "ENABLED")
                .and(StringUtils.hasText(normalizedKeyword), wrapper -> wrapper
                        .like(SysUser::getUsername, normalizedKeyword)
                        .or()
                        .like(SysUser::getNickname, normalizedKeyword))
                .orderByAsc(SysUser::getNickname)
                .last("LIMIT " + limit));

        List<Long> deptIds = users.stream()
                .map(SysUser::getDeptId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<Long, SysDept> departments = deptIds.isEmpty()
                ? Map.of()
                : deptMapper.selectBatchIds(deptIds).stream()
                        .collect(Collectors.toMap(SysDept::getId, Function.identity()));

        return users.stream()
                .map(user -> AssigneeUserOptionVO.from(
                        user,
                        user.getDeptId() == null || departments.get(user.getDeptId()) == null
                                ? null
                                : departments.get(user.getDeptId()).getDeptName()))
                .toList();
    }

    static int normalizeLimit(Integer requestedLimit) {
        if (requestedLimit == null) {
            return DEFAULT_LIMIT;
        }
        return Math.max(1, Math.min(requestedLimit, MAX_LIMIT));
    }
}
