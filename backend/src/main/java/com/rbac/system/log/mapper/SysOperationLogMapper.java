package com.rbac.system.log.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.system.log.entity.SysOperationLog;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface SysOperationLogMapper extends BaseMapper<SysOperationLog> {
}
