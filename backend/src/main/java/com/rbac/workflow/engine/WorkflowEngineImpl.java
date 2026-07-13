package com.rbac.workflow.engine;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.common.exception.BusinessException;
import com.rbac.common.util.SecurityUtils;
import com.rbac.security.model.LoginUser;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import com.rbac.workflow.definition.entity.WfProcessDefinition;
import com.rbac.workflow.definition.entity.WfProcessNode;
import com.rbac.workflow.definition.mapper.WfProcessDefinitionMapper;
import com.rbac.workflow.definition.mapper.WfProcessNodeMapper;
import com.rbac.workflow.instance.entity.WfProcessInstance;
import com.rbac.workflow.instance.mapper.WfProcessInstanceMapper;
import com.rbac.workflow.support.AssigneeResolver;
import com.rbac.workflow.support.ConditionEvaluator;
import com.rbac.workflow.task.entity.WfProcessRecord;
import com.rbac.workflow.task.entity.WfProcessTask;
import com.rbac.workflow.task.mapper.WfProcessRecordMapper;
import com.rbac.workflow.task.mapper.WfProcessTaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 轻量工作流引擎实现：串行节点 + 或签(ANY)/会签(ALL) + 条件分支 + 驳回回退。
 *
 * <p>状态机见设计文档第四节。并发（会签多人同时处理）通过实例 {@code @Version} 乐观锁保护，
 * 节点推进失败即抛出并发异常，避免重复推进。审批人为空由 {@link AssigneeResolver} 阻断。
 */
@Service
public class WorkflowEngineImpl implements WorkflowEngine {

    private static final int COMMENT_MAX = 500;

    private final WfProcessDefinitionMapper definitionMapper;
    private final WfProcessNodeMapper nodeMapper;
    private final WfProcessInstanceMapper instanceMapper;
    private final WfProcessTaskMapper taskMapper;
    private final WfProcessRecordMapper recordMapper;
    private final AssigneeResolver assigneeResolver;
    private final ConditionEvaluator conditionEvaluator;
    private final SysUserMapper userMapper;
    private final ObjectMapper objectMapper;

    public WorkflowEngineImpl(WfProcessDefinitionMapper definitionMapper, WfProcessNodeMapper nodeMapper,
                              WfProcessInstanceMapper instanceMapper, WfProcessTaskMapper taskMapper,
                              WfProcessRecordMapper recordMapper, AssigneeResolver assigneeResolver,
                              ConditionEvaluator conditionEvaluator, SysUserMapper userMapper,
                              ObjectMapper objectMapper) {
        this.definitionMapper = definitionMapper;
        this.nodeMapper = nodeMapper;
        this.instanceMapper = instanceMapper;
        this.taskMapper = taskMapper;
        this.recordMapper = recordMapper;
        this.assigneeResolver = assigneeResolver;
        this.conditionEvaluator = conditionEvaluator;
        this.userMapper = userMapper;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long start(String processKey, String businessKey, String title, Map<String, Object> formData) {
        LoginUser user = SecurityUtils.getLoginUser();
        WfProcessDefinition def = loadEnabledDefinition(processKey);
        List<WfProcessNode> nodes = loadNodes(def.getId());
        if (nodes.isEmpty()) {
            throw new BusinessException("workflow.definition.noNodes");
        }

        WfProcessInstance instance = new WfProcessInstance();
        instance.setDefinitionId(def.getId());
        instance.setProcessKey(def.getProcessKey());
        instance.setBusinessKey(businessKey);
        instance.setTitle(title);
        instance.setInitiatorId(user.getUserId());
        instance.setInitiatorDeptId(user.getDeptId());
        instance.setInstanceStatus("RUNNING");
        instance.setFormData(writeJson(formData));
        instance.setSubmitTime(LocalDateTime.now());
        instance.setVersion(0);
        instanceMapper.insert(instance);

        writeRecord(instance.getId(), null, user.getUserId(), "SUBMIT", null);

        // 进入首个满足条件的节点（从 0 开始找 order > 0）
        enterNextNode(instance, nodes, 0, formData);
        return instance.getId();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void approve(Long taskId, String comment) {
        WfProcessTask task = requirePendingTaskOfCurrentUser(taskId);
        WfProcessInstance instance = requireRunningInstance(task.getInstanceId());

        completeTask(task, "APPROVED");
        writeRecord(instance.getId(), task.getNodeOrder(), task.getAssigneeId(), "APPROVE", comment);

        WfProcessNode node = getNode(instance.getDefinitionId(), task.getNodeOrder());
        if (isNodePassed(node, instance.getId(), task.getNodeOrder())) {
            cancelPendingTasksOfNode(instance.getId(), task.getNodeOrder());
            enterNextNode(instance, loadNodes(instance.getDefinitionId()),
                    task.getNodeOrder(), parseForm(instance));
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void reject(Long taskId, String comment) {
        WfProcessTask task = requirePendingTaskOfCurrentUser(taskId);
        WfProcessInstance instance = requireRunningInstance(task.getInstanceId());

        completeTask(task, "REJECTED");
        writeRecord(instance.getId(), task.getNodeOrder(), task.getAssigneeId(), "REJECT", comment);
        // 同节点其余待办作废
        cancelPendingTasksOfNode(instance.getId(), task.getNodeOrder());

        WfProcessNode node = getNode(instance.getDefinitionId(), task.getNodeOrder());
        List<WfProcessNode> nodes = loadNodes(instance.getDefinitionId());
        if ("TO_PREV".equals(node.getRejectStrategy())) {
            WfProcessNode prev = previousApplicableNode(nodes, task.getNodeOrder(), parseForm(instance));
            if (prev != null) {
                moveToNode(instance, prev);
                return;
            }
        }
        // 驳回到发起人 / 无上一节点：实例置为 REJECTED 终态
        finishInstance(instance, "REJECTED");
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void transfer(Long taskId, Long targetUserId, String comment) {
        WfProcessTask task = requirePendingTaskOfCurrentUser(taskId);
        WfProcessInstance instance = requireRunningInstance(task.getInstanceId());
        if (targetUserId == null) {
            throw new BusinessException("workflow.transfer.targetRequired");
        }
        SysUser target = userMapper.selectById(targetUserId);
        if (target == null || !"ENABLED".equals(target.getStatus())) {
            throw new BusinessException("workflow.transfer.targetInvalid");
        }

        completeTask(task, "TRANSFERRED");
        WfProcessTask newTask = new WfProcessTask();
        newTask.setInstanceId(task.getInstanceId());
        newTask.setNodeOrder(task.getNodeOrder());
        newTask.setNodeName(task.getNodeName());
        newTask.setAssigneeId(targetUserId);
        newTask.setTaskStatus("PENDING");
        taskMapper.insert(newTask);

        writeRecord(instance.getId(), task.getNodeOrder(), task.getAssigneeId(), "TRANSFER", comment);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void withdraw(Long instanceId, String comment) {
        LoginUser user = SecurityUtils.getLoginUser();
        WfProcessInstance instance = instanceMapper.selectById(instanceId);
        if (instance == null) {
            throw new BusinessException("workflow.instance.notFound");
        }
        if (!user.getUserId().equals(instance.getInitiatorId())) {
            throw new BusinessException("workflow.instance.notInitiator");
        }
        if (!"RUNNING".equals(instance.getInstanceStatus())) {
            throw new BusinessException("workflow.instance.notRunning");
        }
        cancelAllPendingTasks(instanceId);
        finishInstance(instance, "CANCELED");
        writeRecord(instanceId, instance.getCurrentNodeOrder(), user.getUserId(), "WITHDRAW", comment);
    }

    // ============================ 内部流转 ============================

    /**
     * 从 fromOrder 之后寻找首个满足条件的节点并进入：解析审批人、生成待办。
     * 若之后无可进入节点，则实例审批通过（APPROVED）。
     */
    private void enterNextNode(WfProcessInstance instance, List<WfProcessNode> nodes,
                               int fromOrder, Map<String, Object> formData) {
        WfProcessNode next = null;
        for (WfProcessNode n : nodes) {
            if (n.getNodeOrder() > fromOrder && conditionEvaluator.matches(n.getConditionExpr(), formData)) {
                next = n;
                break;
            }
        }
        if (next == null) {
            finishInstance(instance, "APPROVED");
            return;
        }
        moveToNode(instance, next);
    }

    /** 将实例切换到目标节点并生成该节点的待办任务。 */
    private void moveToNode(WfProcessInstance instance, WfProcessNode node) {
        List<Long> assignees = assigneeResolver.resolve(node, instance);
        instance.setCurrentNodeOrder(node.getNodeOrder());
        updateInstanceWithLock(instance);
        for (Long assigneeId : assignees) {
            WfProcessTask task = new WfProcessTask();
            task.setInstanceId(instance.getId());
            task.setNodeOrder(node.getNodeOrder());
            task.setNodeName(node.getNodeName());
            task.setAssigneeId(assigneeId);
            task.setTaskStatus("PENDING");
            taskMapper.insert(task);
        }
        // TODO(通知模块 P0)：此处触发「任务分派」站内消息
    }

    /**
     * 判断节点是否已通过：
     * <ul>
     *   <li>ANY（或签）：任一同意即通过。</li>
     *   <li>ALL / SEQUENTIAL（会签）：无剩余待办才通过（首期 SEQUENTIAL 等同 ALL）。</li>
     * </ul>
     */
    private boolean isNodePassed(WfProcessNode node, Long instanceId, Integer nodeOrder) {
        if ("ANY".equals(node.getApproveMode())) {
            return true;
        }
        long pending = taskMapper.selectCount(Wrappers.<WfProcessTask>lambdaQuery()
                .eq(WfProcessTask::getInstanceId, instanceId)
                .eq(WfProcessTask::getNodeOrder, nodeOrder)
                .eq(WfProcessTask::getTaskStatus, "PENDING"));
        return pending == 0;
    }

    /** 上一节点（order 最大且满足条件的、order < current）。 */
    private WfProcessNode previousApplicableNode(List<WfProcessNode> nodes, int currentOrder,
                                                 Map<String, Object> formData) {
        WfProcessNode prev = null;
        for (WfProcessNode n : nodes) {
            if (n.getNodeOrder() < currentOrder
                    && conditionEvaluator.matches(n.getConditionExpr(), formData)) {
                if (prev == null || n.getNodeOrder() > prev.getNodeOrder()) {
                    prev = n;
                }
            }
        }
        return prev;
    }

    private void finishInstance(WfProcessInstance instance, String status) {
        instance.setInstanceStatus(status);
        instance.setEndTime(LocalDateTime.now());
        updateInstanceWithLock(instance);
    }

    private void completeTask(WfProcessTask task, String status) {
        WfProcessTask update = new WfProcessTask();
        update.setId(task.getId());
        update.setTaskStatus(status);
        update.setApproveTime(LocalDateTime.now());
        taskMapper.updateById(update);
    }

    private void cancelPendingTasksOfNode(Long instanceId, Integer nodeOrder) {
        WfProcessTask update = new WfProcessTask();
        update.setTaskStatus("CANCELED");
        taskMapper.update(update, Wrappers.<WfProcessTask>lambdaUpdate()
                .eq(WfProcessTask::getInstanceId, instanceId)
                .eq(WfProcessTask::getNodeOrder, nodeOrder)
                .eq(WfProcessTask::getTaskStatus, "PENDING"));
    }

    private void cancelAllPendingTasks(Long instanceId) {
        WfProcessTask update = new WfProcessTask();
        update.setTaskStatus("CANCELED");
        taskMapper.update(update, Wrappers.<WfProcessTask>lambdaUpdate()
                .eq(WfProcessTask::getInstanceId, instanceId)
                .eq(WfProcessTask::getTaskStatus, "PENDING"));
    }

    /** 乐观锁更新实例；受并发影响未命中行时抛出并发异常。 */
    private void updateInstanceWithLock(WfProcessInstance instance) {
        int rows = instanceMapper.updateById(instance);
        if (rows == 0) {
            throw new BusinessException("workflow.instance.concurrentModified");
        }
    }

    // ============================ 校验与工具 ============================

    private WfProcessTask requirePendingTaskOfCurrentUser(Long taskId) {
        Long userId = SecurityUtils.getUserId();
        WfProcessTask task = taskMapper.selectById(taskId);
        if (task == null) {
            throw new BusinessException("workflow.task.notFound");
        }
        if (!"PENDING".equals(task.getTaskStatus())) {
            throw new BusinessException("workflow.task.notPending");
        }
        if (!userId.equals(task.getAssigneeId())) {
            throw new BusinessException("workflow.task.notAssignee");
        }
        return task;
    }

    private WfProcessInstance requireRunningInstance(Long instanceId) {
        WfProcessInstance instance = instanceMapper.selectById(instanceId);
        if (instance == null) {
            throw new BusinessException("workflow.instance.notFound");
        }
        if (!"RUNNING".equals(instance.getInstanceStatus())) {
            throw new BusinessException("workflow.instance.notRunning");
        }
        return instance;
    }

    private WfProcessDefinition loadEnabledDefinition(String processKey) {
        List<WfProcessDefinition> defs = definitionMapper.selectList(
                Wrappers.<WfProcessDefinition>lambdaQuery()
                        .eq(WfProcessDefinition::getProcessKey, processKey)
                        .eq(WfProcessDefinition::getStatus, "ENABLED")
                        .orderByDesc(WfProcessDefinition::getVersion));
        if (defs.isEmpty()) {
            throw new BusinessException("workflow.definition.notEnabled", processKey);
        }
        return defs.get(0);
    }

    private List<WfProcessNode> loadNodes(Long definitionId) {
        return nodeMapper.selectList(Wrappers.<WfProcessNode>lambdaQuery()
                .eq(WfProcessNode::getDefinitionId, definitionId)
                .orderByAsc(WfProcessNode::getNodeOrder));
    }

    private WfProcessNode getNode(Long definitionId, Integer nodeOrder) {
        WfProcessNode node = nodeMapper.selectOne(Wrappers.<WfProcessNode>lambdaQuery()
                .eq(WfProcessNode::getDefinitionId, definitionId)
                .eq(WfProcessNode::getNodeOrder, nodeOrder)
                .last("LIMIT 1"));
        if (node == null) {
            throw new BusinessException("workflow.node.notFound");
        }
        return node;
    }

    private void writeRecord(Long instanceId, Integer nodeOrder, Long operatorId, String action, String comment) {
        WfProcessRecord record = new WfProcessRecord();
        record.setInstanceId(instanceId);
        record.setNodeOrder(nodeOrder);
        record.setOperatorId(operatorId);
        record.setAction(action);
        record.setComment(truncate(comment));
        record.setOperateTime(LocalDateTime.now());
        recordMapper.insert(record);
    }

    private String truncate(String comment) {
        if (comment == null) {
            return null;
        }
        return comment.length() <= COMMENT_MAX ? comment : comment.substring(0, COMMENT_MAX);
    }

    private String writeJson(Map<String, Object> formData) {
        if (formData == null || formData.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(formData);
        } catch (Exception e) {
            throw new BusinessException("workflow.form.serializeFailed");
        }
    }

    private Map<String, Object> parseForm(WfProcessInstance instance) {
        String json = instance.getFormData();
        if (!StringUtils.hasText(json)) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {
            });
        } catch (Exception e) {
            return Map.of();
        }
    }
}
