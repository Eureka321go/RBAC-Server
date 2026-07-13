package com.rbac.workflow.definition.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.rbac.common.domain.PageResult;
import com.rbac.common.exception.BusinessException;
import com.rbac.workflow.definition.dto.DefinitionQuery;
import com.rbac.workflow.definition.dto.DefinitionSaveRequest;
import com.rbac.workflow.definition.dto.NodeSaveRequest;
import com.rbac.workflow.definition.entity.WfProcessDefinition;
import com.rbac.workflow.definition.entity.WfProcessNode;
import com.rbac.workflow.definition.mapper.WfProcessDefinitionMapper;
import com.rbac.workflow.definition.mapper.WfProcessNodeMapper;
import com.rbac.workflow.definition.vo.DefinitionVO;
import com.rbac.workflow.definition.vo.NodeVO;
import com.rbac.workflow.instance.entity.WfProcessInstance;
import com.rbac.workflow.instance.mapper.WfProcessInstanceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 流程定义管理：定义 + 节点的 CRUD。
 *
 * <p>版本策略（对齐设计文档「运行中实例锁定发起时版本」）：编辑不覆盖原定义，
 * 而是生成新版本（version+1）并停用旧版本；在途实例仍引用其发起时的定义行，不受影响。
 * 引擎发起时取「同 process_key 中启用的最高版本」。
 */
@Service
public class DefinitionService {

    private final WfProcessDefinitionMapper definitionMapper;
    private final WfProcessNodeMapper nodeMapper;
    private final WfProcessInstanceMapper instanceMapper;

    public DefinitionService(WfProcessDefinitionMapper definitionMapper, WfProcessNodeMapper nodeMapper,
                             WfProcessInstanceMapper instanceMapper) {
        this.definitionMapper = definitionMapper;
        this.nodeMapper = nodeMapper;
        this.instanceMapper = instanceMapper;
    }

    public PageResult<DefinitionVO> page(DefinitionQuery query) {
        IPage<WfProcessDefinition> page = definitionMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<WfProcessDefinition>lambdaQuery()
                        .eq(StringUtils.hasText(query.getProcessKey()),
                                WfProcessDefinition::getProcessKey, query.getProcessKey())
                        .like(StringUtils.hasText(query.getName()),
                                WfProcessDefinition::getName, query.getName())
                        .eq(StringUtils.hasText(query.getCategory()),
                                WfProcessDefinition::getCategory, query.getCategory())
                        .eq(StringUtils.hasText(query.getStatus()),
                                WfProcessDefinition::getStatus, query.getStatus())
                        .orderByAsc(WfProcessDefinition::getProcessKey)
                        .orderByDesc(WfProcessDefinition::getVersion));
        return PageResult.from(page, DefinitionVO::from);
    }

    public DefinitionVO detail(Long id) {
        WfProcessDefinition def = getById(id);
        DefinitionVO vo = DefinitionVO.from(def);
        vo.setNodes(loadNodeVos(id));
        return vo;
    }

    @Transactional(rollbackFor = Exception.class)
    public Long create(DefinitionSaveRequest req) {
        long exists = definitionMapper.selectCount(Wrappers.<WfProcessDefinition>lambdaQuery()
                .eq(WfProcessDefinition::getProcessKey, req.getProcessKey()));
        if (exists > 0) {
            throw new BusinessException("workflow.definition.keyExists", req.getProcessKey());
        }
        validateNodeOrders(req.getNodes());

        WfProcessDefinition def = new WfProcessDefinition();
        apply(def, req);
        def.setVersion(1);
        def.setStatus(req.getStatus() == null ? "ENABLED" : req.getStatus());
        definitionMapper.insert(def);
        insertNodes(def.getId(), req.getNodes());
        return def.getId();
    }

    @Transactional(rollbackFor = Exception.class)
    public Long update(DefinitionSaveRequest req) {
        if (req.getId() == null) {
            throw new BusinessException("workflow.definition.idRequired");
        }
        WfProcessDefinition old = getById(req.getId());
        // process_key 不可改（版本以 key 归组）
        if (!old.getProcessKey().equals(req.getProcessKey())) {
            throw new BusinessException("workflow.definition.keyImmutable");
        }
        validateNodeOrders(req.getNodes());

        Integer maxVersion = currentMaxVersion(old.getProcessKey());
        WfProcessDefinition next = new WfProcessDefinition();
        apply(next, req);
        next.setVersion(maxVersion + 1);
        next.setStatus(req.getStatus() == null ? "ENABLED" : req.getStatus());
        definitionMapper.insert(next);
        insertNodes(next.getId(), req.getNodes());

        // 停用同 key 其它版本，保持单一启用版本
        WfProcessDefinition disable = new WfProcessDefinition();
        disable.setStatus("DISABLED");
        definitionMapper.update(disable, Wrappers.<WfProcessDefinition>lambdaUpdate()
                .eq(WfProcessDefinition::getProcessKey, old.getProcessKey())
                .ne(WfProcessDefinition::getId, next.getId()));
        return next.getId();
    }

    public void updateStatus(Long id, String status) {
        getById(id);
        WfProcessDefinition update = new WfProcessDefinition();
        update.setId(id);
        update.setStatus(status);
        definitionMapper.updateById(update);
    }

    @Transactional(rollbackFor = Exception.class)
    public void delete(Long id) {
        getById(id);
        long running = instanceMapper.selectCount(Wrappers.<WfProcessInstance>lambdaQuery()
                .eq(WfProcessInstance::getDefinitionId, id)
                .in(WfProcessInstance::getInstanceStatus, List.of("RUNNING", "DRAFT")));
        if (running > 0) {
            throw new BusinessException("workflow.definition.hasRunningInstance");
        }
        nodeMapper.delete(Wrappers.<WfProcessNode>lambdaQuery().eq(WfProcessNode::getDefinitionId, id));
        definitionMapper.deleteById(id);
    }

    // ============================ 内部 ============================

    private WfProcessDefinition getById(Long id) {
        WfProcessDefinition def = definitionMapper.selectById(id);
        if (def == null) {
            throw new BusinessException("workflow.definition.notFound");
        }
        return def;
    }

    private List<NodeVO> loadNodeVos(Long definitionId) {
        return nodeMapper.selectList(Wrappers.<WfProcessNode>lambdaQuery()
                        .eq(WfProcessNode::getDefinitionId, definitionId)
                        .orderByAsc(WfProcessNode::getNodeOrder))
                .stream().map(NodeVO::from).toList();
    }

    private Integer currentMaxVersion(String processKey) {
        return definitionMapper.selectList(Wrappers.<WfProcessDefinition>lambdaQuery()
                        .eq(WfProcessDefinition::getProcessKey, processKey)
                        .orderByDesc(WfProcessDefinition::getVersion))
                .stream().map(WfProcessDefinition::getVersion).findFirst().orElse(0);
    }

    private void insertNodes(Long definitionId, List<NodeSaveRequest> nodes) {
        for (NodeSaveRequest n : nodes) {
            requireAssigneeValue(n);
            WfProcessNode node = new WfProcessNode();
            node.setDefinitionId(definitionId);
            node.setNodeOrder(n.getNodeOrder());
            node.setNodeName(n.getNodeName());
            node.setAssigneeType(n.getAssigneeType());
            node.setAssigneeValue(n.getAssigneeValue());
            node.setApproveMode(n.getApproveMode() == null ? "ANY" : n.getApproveMode());
            node.setRejectStrategy(n.getRejectStrategy() == null ? "TO_INITIATOR" : n.getRejectStrategy());
            node.setConditionExpr(n.getConditionExpr());
            nodeMapper.insert(node);
        }
    }

    private void apply(WfProcessDefinition def, DefinitionSaveRequest req) {
        def.setProcessKey(req.getProcessKey());
        def.setName(req.getName());
        def.setCategory(req.getCategory());
        def.setFormKey(req.getFormKey());
        def.setRemark(req.getRemark());
    }

    /** 节点顺序需唯一且从 1 递增连续。 */
    private void validateNodeOrders(List<NodeSaveRequest> nodes) {
        List<Integer> orders = nodes.stream().map(NodeSaveRequest::getNodeOrder).sorted().toList();
        for (int i = 0; i < orders.size(); i++) {
            if (orders.get(i) != i + 1) {
                throw new BusinessException("workflow.definition.nodeOrderInvalid");
            }
        }
    }

    /** USER/ROLE/POST 类型必须提供 assigneeValue。 */
    private void requireAssigneeValue(NodeSaveRequest n) {
        String type = n.getAssigneeType();
        if (("USER".equals(type) || "ROLE".equals(type) || "POST".equals(type))
                && !StringUtils.hasText(n.getAssigneeValue())) {
            throw new BusinessException("workflow.node.assigneeValueRequired", n.getNodeName());
        }
    }
}
