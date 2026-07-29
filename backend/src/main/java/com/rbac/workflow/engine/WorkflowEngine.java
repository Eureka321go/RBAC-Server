package com.rbac.workflow.engine;

import java.util.Map;

/**
 * 工作流引擎接口：隔离实现，便于后续替换为 Flowable 适配器而不影响业务模块。
 * 业务侧只依赖本接口。
 */
public interface WorkflowEngine {

    /**
     * 发起一个流程实例。
     *
     * @param processKey  流程标识（取当前启用的最新版本定义）
     * @param businessKey 业务单据 ID（可空）
     * @param title       单据标题
     * @param formData    表单数据快照（可空）
     * @return 新建流程实例 ID
     */
    Long start(String processKey, String businessKey, String title, Map<String, Object> formData);

    /** 同意（审批人对某任务）。 */
    void approve(Long taskId, String comment);

    /** 驳回（按节点驳回策略回退或终止）。 */
    void reject(Long taskId, String comment);

    /** 转办给他人（原任务标记 TRANSFERRED，为目标人新建待办）。 */
    void transfer(Long taskId, Long targetUserId, String comment);

    /** 发起人撤回（实例置为 CANCELED，取消所有待办）。 */
    void withdraw(Long instanceId, String comment);
}
