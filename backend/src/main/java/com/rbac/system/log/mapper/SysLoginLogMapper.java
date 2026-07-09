package com.rbac.system.log.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.system.log.entity.SysLoginLog;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface SysLoginLogMapper extends BaseMapper<SysLoginLog> {
}
