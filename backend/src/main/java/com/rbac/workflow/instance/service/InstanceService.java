package com.rbac.workflow.instance.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.common.domain.PageResult;
import com.rbac.common.exception.BusinessException;
import com.rbac.common.util.SecurityUtils;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import com.rbac.workflow.engine.WorkflowEngine;
import com.rbac.workflow.instance.dto.InstanceQuery;
import com.rbac.workflow.instance.dto.InstanceStartRequest;
import com.rbac.workflow.instance.entity.WfProcessCc;
import com.rbac.workflow.instance.entity.WfProcessInstance;
import com.rbac.workflow.instance.mapper.WfProcessCcMapper;
import com.rbac.workflow.instance.mapper.WfProcessInstanceMapper;
import com.rbac.workflow.instance.vo.CcVO;
import com.rbac.workflow.instance.vo.InstanceDetailVO;
import com.rbac.workflow.instance.vo.InstanceVO;
import com.rbac.workflow.instance.vo.RecordVO;
import com.rbac.workflow.task.entity.WfProcessRecord;
import com.rbac.workflow.task.entity.WfProcessTask;
import com.rbac.workflow.task.mapper.WfProcessRecordMapper;
import com.rbac.workflow.task.mapper.WfProcessTaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 流程实例服务：发起、撤回、我发起的查询、详情时间线、抄送。
 *
 * <p>数据权限：{@code mine}/{@code ccMine} 严格按当前用户过滤；{@code detail} 仅放行
 * 发起人、该实例的审批人（历史或当前）或超管，避免越权查看他人单据（安全红线）。
 */
@Service
public class InstanceService {

    private final WorkflowEngine workflowEngine;
    private final WfProcessInstanceMapper instanceMapper;
    private final WfProcessRecordMapper recordMapper;
    private final WfProcessTaskMapper taskMapper;
    private final WfProcessCcMapper ccMapper;
    private final SysUserMapper userMapper;
    private final ObjectMapper objectMapper;

    public InstanceService(WorkflowEngine workflowEngine, WfProcessInstanceMapper instanceMapper,
                           WfProcessRecordMapper recordMapper, WfProcessTaskMapper taskMapper,
                           WfProcessCcMapper ccMapper, SysUserMapper userMapper, ObjectMapper objectMapper) {
        this.workflowEngine = workflowEngine;
        this.instanceMapper = instanceMapper;
        this.recordMapper = recordMapper;
        this.taskMapper = taskMapper;
        this.ccMapper = ccMapper;
        this.userMapper = userMapper;
        this.objectMapper = objectMapper;
    }

    public Long start(InstanceStartRequest req) {
        return workflowEngine.start(req.getProcessKey(), req.getBusinessKey(), req.getTitle(), req.getFormData());
    }

    public void withdraw(Long instanceId, String comment) {
        workflowEngine.withdraw(instanceId, comment);
    }

    public PageResult<InstanceVO> mine(InstanceQuery query) {
        Long userId = SecurityUtils.getUserId();
        IPage<WfProcessInstance> page = instanceMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<WfProcessInstance>lambdaQuery()
                        .eq(WfProcessInstance::getInitiatorId, userId)
                        .eq(StringUtils.hasText(query.getProcessKey()),
                                WfProcessInstance::getProcessKey, query.getProcessKey())
                        .like(StringUtils.hasText(query.getTitle()),
                                WfProcessInstance::getTitle, query.getTitle())
                        .eq(StringUtils.hasText(query.getInstanceStatus()),
                                WfProcessInstance::getInstanceStatus, query.getInstanceStatus())
                        .orderByDesc(WfProcessInstance::getSubmitTime));
        Map<Long, String> names = userNames(page.getRecords().stream()
                .map(WfProcessInstance::getInitiatorId).collect(Collectors.toSet()));
        List<InstanceVO> records = page.getRecords().stream()
                .map(i -> InstanceVO.from(i, names.get(i.getInitiatorId()))).toList();
        return PageResult.of(records, page.getTotal(), page.getCurrent(), page.getSize());
    }

    public InstanceDetailVO detail(Long id) {
        WfProcessInstance inst = instanceMapper.selectById(id);
        if (inst == null) {
            throw new BusinessException("workflow.instance.notFound");
        }
        requireViewPermission(inst);

        List<WfProcessRecord> records = recordMapper.selectList(Wrappers.<WfProcessRecord>lambdaQuery()
                .eq(WfProcessRecord::getInstanceId, id)
                .orderByAsc(WfProcessRecord::getOperateTime));
        List<WfProcessTask> tasks = taskMapper.selectList(Wrappers.<WfProcessTask>lambdaQuery()
                .eq(WfProcessTask::getInstanceId, id)
                .orderByAsc(WfProcessTask::getNodeOrder).orderByAsc(WfProcessTask::getId));

        // 汇总需要显示名字的用户 id：发起人 + 操作人 + 审批人
        Set<Long> userIds = records.stream().map(WfProcessRecord::getOperatorId).collect(Collectors.toSet());
        userIds.addAll(tasks.stream().map(WfProcessTask::getAssigneeId).collect(Collectors.toSet()));
        userIds.add(inst.getInitiatorId());
        Map<Long, String> names = userNames(userIds);

        InstanceDetailVO vo = new InstanceDetailVO();
        vo.setId(inst.getId());
        vo.setProcessKey(inst.getProcessKey());
        vo.setTitle(inst.getTitle());
        vo.setBusinessKey(inst.getBusinessKey());
        vo.setInstanceStatus(inst.getInstanceStatus());
        vo.setCurrentNodeOrder(inst.getCurrentNodeOrder());
        vo.setInitiatorId(inst.getInitiatorId());
        vo.setInitiatorName(names.get(inst.getInitiatorId()));
        vo.setSubmitTime(inst.getSubmitTime());
        vo.setEndTime(inst.getEndTime());
        vo.setFormData(parseForm(inst.getFormData()));
        vo.setRecords(records.stream().map(r -> RecordVO.from(r, names.get(r.getOperatorId()))).toList());
        vo.setTasks(tasks.stream().map(t -> toBrief(t, names.get(t.getAssigneeId()))).toList());
        return vo;
    }

    public PageResult<CcVO> ccMine(InstanceQuery query) {
        Long userId = SecurityUtils.getUserId();
        IPage<WfProcessCc> page = ccMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<WfProcessCc>lambdaQuery()
                        .eq(WfProcessCc::getUserId, userId)
                        .orderByDesc(WfProcessCc::getCreatedAt));
        Set<Long> instanceIds = page.getRecords().stream()
                .map(WfProcessCc::getInstanceId).collect(Collectors.toSet());
        Map<Long, WfProcessInstance> instMap = instanceIds.isEmpty() ? Map.of()
                : instanceMapper.selectBatchIds(instanceIds).stream()
                        .collect(Collectors.toMap(WfProcessInstance::getId, Function.identity()));
        Map<Long, String> names = userNames(instMap.values().stream()
                .map(WfProcessInstance::getInitiatorId).collect(Collectors.toSet()));
        List<CcVO> records = page.getRecords().stream().map(cc -> {
            WfProcessInstance inst = instMap.get(cc.getInstanceId());
            String name = inst == null ? null : names.get(inst.getInitiatorId());
            return CcVO.from(cc, inst, name);
        }).toList();
        return PageResult.of(records, page.getTotal(), page.getCurrent(), page.getSize());
    }

    public void readCc(Long ccId) {
        Long userId = SecurityUtils.getUserId();
        WfProcessCc cc = ccMapper.selectById(ccId);
        if (cc == null || !userId.equals(cc.getUserId())) {
            throw new BusinessException("workflow.cc.notFound");
        }
        WfProcessCc update = new WfProcessCc();
        update.setId(ccId);
        update.setReadFlag(1);
        ccMapper.updateById(update);
    }

    // ============================ 内部 ============================

    private void requireViewPermission(WfProcessInstance inst) {
        Long userId = SecurityUtils.getUserId();
        if (SecurityUtils.isSuperAdmin() || userId.equals(inst.getInitiatorId())) {
            return;
        }
        long asAssignee = taskMapper.selectCount(Wrappers.<WfProcessTask>lambdaQuery()
                .eq(WfProcessTask::getInstanceId, inst.getId())
                .eq(WfProcessTask::getAssigneeId, userId));
        if (asAssignee > 0) {
            return;
        }
        long asCcRecipient = ccMapper.selectCount(Wrappers.<WfProcessCc>lambdaQuery()
                .eq(WfProcessCc::getInstanceId, inst.getId())
                .eq(WfProcessCc::getUserId, userId));
        if (asCcRecipient == 0) {
            throw new BusinessException(403, "workflow.instance.noViewPermission");
        }
    }

    private InstanceDetailVO.TaskBrief toBrief(WfProcessTask t, String assigneeName) {
        InstanceDetailVO.TaskBrief b = new InstanceDetailVO.TaskBrief();
        b.setId(t.getId());
        b.setNodeOrder(t.getNodeOrder());
        b.setNodeName(t.getNodeName());
        b.setAssigneeId(t.getAssigneeId());
        b.setAssigneeName(assigneeName);
        b.setTaskStatus(t.getTaskStatus());
        b.setApproveTime(t.getApproveTime());
        return b;
    }

    private Map<Long, String> userNames(Set<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Map.of();
        }
        return userMapper.selectBatchIds(ids).stream()
                .collect(Collectors.toMap(SysUser::getId, SysUser::getNickname));
    }

    private Object parseForm(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (Exception e) {
            return json;
        }
    }
}
