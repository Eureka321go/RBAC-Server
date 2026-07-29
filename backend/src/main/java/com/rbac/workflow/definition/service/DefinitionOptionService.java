package com.rbac.workflow.definition.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.rbac.workflow.definition.entity.WfProcessDefinition;
import com.rbac.workflow.definition.mapper.WfProcessDefinitionMapper;
import com.rbac.workflow.definition.vo.DefinitionOptionVO;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 查询普通用户可发起的已启用流程定义。 */
@Service
public class DefinitionOptionService {

    private final WfProcessDefinitionMapper definitionMapper;

    public DefinitionOptionService(WfProcessDefinitionMapper definitionMapper) {
        this.definitionMapper = definitionMapper;
    }

    public List<DefinitionOptionVO> listEnabled() {
        List<WfProcessDefinition> definitions = definitionMapper.selectList(
                Wrappers.<WfProcessDefinition>lambdaQuery()
                        .eq(WfProcessDefinition::getStatus, "ENABLED")
                        .orderByAsc(WfProcessDefinition::getName)
                        .orderByDesc(WfProcessDefinition::getVersion));

        Map<String, DefinitionOptionVO> latestByKey = new LinkedHashMap<>();
        for (WfProcessDefinition definition : definitions) {
            latestByKey.putIfAbsent(definition.getProcessKey(), DefinitionOptionVO.from(definition));
        }
        return List.copyOf(latestByKey.values());
    }
}
