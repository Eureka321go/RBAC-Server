package com.rbac.workflow.support;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.rbac.common.exception.BusinessException;
import com.rbac.system.dept.entity.SysDept;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.entity.SysUserPost;
import com.rbac.system.user.entity.SysUserRole;
import com.rbac.system.user.mapper.SysUserMapper;
import com.rbac.system.user.mapper.SysUserPostMapper;
import com.rbac.system.user.mapper.SysUserRoleMapper;
import com.rbac.workflow.definition.entity.WfProcessNode;
import com.rbac.workflow.instance.entity.WfProcessInstance;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 审批人解析器：按节点 {@code assigneeType} + {@code assigneeValue} + 实例上下文，
 * 解析出实际审批人 id 列表。复用现有 RBAC 用户/角色/岗位/部门数据，避免二次建模。
 *
 * <p>安全：解析结果为空（如部门未设负责人）时抛出业务异常阻断，绝不静默跳过节点。
 * 同时过滤掉非启用状态的用户，避免把待办派给停用账号。
 */
@Component
public class AssigneeResolver {

    private final SysUserRoleMapper userRoleMapper;
    private final SysUserPostMapper userPostMapper;
    private final SysDeptMapper deptMapper;
    private final SysUserMapper userMapper;

    public AssigneeResolver(SysUserRoleMapper userRoleMapper, SysUserPostMapper userPostMapper,
                            SysDeptMapper deptMapper, SysUserMapper userMapper) {
        this.userRoleMapper = userRoleMapper;
        this.userPostMapper = userPostMapper;
        this.deptMapper = deptMapper;
        this.userMapper = userMapper;
    }

    public List<Long> resolve(WfProcessNode node, WfProcessInstance instance) {
        Set<Long> result = new LinkedHashSet<>();
        String type = node.getAssigneeType();
        switch (type) {
            case "USER" -> result.addAll(parseIds(node.getAssigneeValue()));
            case "ROLE" -> {
                List<Long> roleIds = parseIds(node.getAssigneeValue());
                if (!roleIds.isEmpty()) {
                    userRoleMapper.selectList(Wrappers.<SysUserRole>lambdaQuery()
                                    .in(SysUserRole::getRoleId, roleIds))
                            .forEach(ur -> result.add(ur.getUserId()));
                }
            }
            case "POST" -> {
                List<Long> postIds = parseIds(node.getAssigneeValue());
                if (!postIds.isEmpty()) {
                    userPostMapper.selectList(Wrappers.<SysUserPost>lambdaQuery()
                                    .in(SysUserPost::getPostId, postIds))
                            .forEach(up -> result.add(up.getUserId()));
                }
            }
            case "DEPT_LEADER" -> {
                Long leader = deptLeader(instance.getInitiatorDeptId());
                if (leader != null) {
                    result.add(leader);
                }
            }
            case "INITIATOR_SELF" -> result.add(instance.getInitiatorId());
            case "INITIATOR_LEADER" -> {
                Long leader = initiatorLeader(instance);
                if (leader != null) {
                    result.add(leader);
                }
            }
            default -> throw new BusinessException("workflow.assignee.typeInvalid", type);
        }

        List<Long> enabled = filterEnabled(result);
        if (enabled.isEmpty()) {
            throw new BusinessException("workflow.assignee.empty", node.getNodeName());
        }
        return enabled;
    }

    /** 部门负责人。 */
    private Long deptLeader(Long deptId) {
        if (deptId == null) {
            return null;
        }
        SysDept dept = deptMapper.selectById(deptId);
        return dept == null ? null : dept.getLeaderUserId();
    }

    /**
     * 发起人直属上级：先取发起人所在部门负责人；
     * 若发起人本人就是该部门负责人，则上溯父部门负责人。
     */
    private Long initiatorLeader(WfProcessInstance instance) {
        Long deptId = instance.getInitiatorDeptId();
        if (deptId == null) {
            return null;
        }
        SysDept dept = deptMapper.selectById(deptId);
        if (dept == null) {
            return null;
        }
        Long leader = dept.getLeaderUserId();
        if (leader != null && !leader.equals(instance.getInitiatorId())) {
            return leader;
        }
        // 本人即负责人（或部门无负责人），上溯父部门
        Long parentId = dept.getParentId();
        if (parentId == null || parentId == 0L) {
            return leader;
        }
        SysDept parent = deptMapper.selectById(parentId);
        return parent == null ? leader : parent.getLeaderUserId();
    }

    private List<Long> parseIds(String value) {
        if (!StringUtils.hasText(value)) {
            return List.of();
        }
        return Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(StringUtils::hasText)
                .map(Long::valueOf)
                .toList();
    }

    private List<Long> filterEnabled(Set<Long> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        List<SysUser> users = userMapper.selectList(Wrappers.<SysUser>lambdaQuery()
                .in(SysUser::getId, ids)
                .eq(SysUser::getStatus, "ENABLED"));
        Set<Long> enabledIds = new LinkedHashSet<>();
        users.forEach(u -> enabledIds.add(u.getId()));
        // 保持解析顺序
        List<Long> ordered = new ArrayList<>();
        for (Long id : ids) {
            if (enabledIds.contains(id)) {
                ordered.add(id);
            }
        }
        return ordered;
    }
}
