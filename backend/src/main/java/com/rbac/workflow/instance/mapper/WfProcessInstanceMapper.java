package com.rbac.workflow.instance.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.workflow.instance.entity.WfProcessInstance;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface WfProcessInstanceMapper extends BaseMapper<WfProcessInstance> {
}
