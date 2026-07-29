package com.rbac.workflow.definition.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.workflow.definition.entity.WfProcessDefinition;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface WfProcessDefinitionMapper extends BaseMapper<WfProcessDefinition> {
}
