package com.rbac.workflow.task.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.rbac.common.domain.PageResult;
import com.rbac.common.util.SecurityUtils;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import com.rbac.workflow.engine.WorkflowEngine;
import com.rbac.workflow.instance.entity.WfProcessInstance;
import com.rbac.workflow.instance.mapper.WfProcessInstanceMapper;
import com.rbac.workflow.task.dto.TaskQuery;
import com.rbac.workflow.task.entity.WfProcessTask;
import com.rbac.workflow.task.mapper.WfProcessTaskMapper;
import com.rbac.workflow.task.vo.TaskVO;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 审批任务服务：我的待办 / 已办查询 + 审批动作（委托引擎）。
 *
 * <p>数据权限：待办/已办严格按 {@code assignee_id = 当前用户} 过滤，不可绕过（安全红线）。
 * 审批动作不设静态权限码，由引擎在 Service 层二次校验「当前用户是否为该任务合法审批人」。
 */
@Service
public class TaskService {

    private static final List<String> DONE_STATUSES = List.of("APPROVED", "REJECTED", "TRANSFERRED");

    private final WfProcessTaskMapper taskMapper;
    private final WfProcessInstanceMapper instanceMapper;
    private final SysUserMapper userMapper;
    private final WorkflowEngine workflowEngine;

    public TaskService(WfProcessTaskMapper taskMapper, WfProcessInstanceMapper instanceMapper,
                       SysUserMapper userMapper, WorkflowEngine workflowEngine) {
        this.taskMapper = taskMapper;
        this.instanceMapper = instanceMapper;
        this.userMapper = userMapper;
        this.workflowEngine = workflowEngine;
    }

    public PageResult<TaskVO> todo(TaskQuery query) {
        return pageTasks(query, w -> w.eq(WfProcessTask::getTaskStatus, "PENDING"));
    }

    public PageResult<TaskVO> done(TaskQuery query) {
        return pageTasks(query, w -> w.in(WfProcessTask::getTaskStatus, DONE_STATUSES));
    }

    public void approve(Long taskId, String comment) {
        workflowEngine.approve(taskId, comment);
    }

    public void reject(Long taskId, String comment) {
        workflowEngine.reject(taskId, comment);
    }

    public void transfer(Long taskId, Long targetUserId, String comment) {
        workflowEngine.transfer(taskId, targetUserId, comment);
    }

    // ============================ 内部 ============================

    private PageResult<TaskVO> pageTasks(TaskQuery query, Consumer<LambdaQueryWrapper<WfProcessTask>> statusFilter) {
        Long userId = SecurityUtils.getUserId();
        LambdaQueryWrapper<WfProcessTask> wrapper = Wrappers.<WfProcessTask>lambdaQuery()
                .eq(WfProcessTask::getAssigneeId, userId);
        statusFilter.accept(wrapper);
        wrapper.orderByDesc(WfProcessTask::getCreatedAt);

        IPage<WfProcessTask> page = taskMapper.selectPage(Page.of(query.current(), query.size()), wrapper);
        List<WfProcessTask> tasks = page.getRecords();

        Map<Long, WfProcessInstance> instanceMap = loadInstances(tasks);
        Map<Long, String> nameMap = loadInitiatorNames(instanceMap.values());

        List<TaskVO> records = tasks.stream().map(t -> {
            WfProcessInstance inst = instanceMap.get(t.getInstanceId());
            String initiatorName = inst == null ? null : nameMap.get(inst.getInitiatorId());
            return TaskVO.from(t, inst, initiatorName);
        }).toList();
        return PageResult.of(records, page.getTotal(), page.getCurrent(), page.getSize());
    }

    private Map<Long, WfProcessInstance> loadInstances(List<WfProcessTask> tasks) {
        Set<Long> ids = tasks.stream().map(WfProcessTask::getInstanceId).collect(Collectors.toSet());
        if (ids.isEmpty()) {
            return Map.of();
        }
        return instanceMapper.selectBatchIds(ids).stream()
                .collect(Collectors.toMap(WfProcessInstance::getId, Function.identity()));
    }

    private Map<Long, String> loadInitiatorNames(Collection<WfProcessInstance> instances) {
        Set<Long> userIds = instances.stream().map(WfProcessInstance::getInitiatorId).collect(Collectors.toSet());
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return userMapper.selectBatchIds(userIds).stream()
                .collect(Collectors.toMap(SysUser::getId, SysUser::getNickname));
    }
}
