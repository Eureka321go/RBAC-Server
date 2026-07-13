package com.rbac.workflow.task.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.workflow.task.entity.WfProcessRecord;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface WfProcessRecordMapper extends BaseMapper<WfProcessRecord> {
}
