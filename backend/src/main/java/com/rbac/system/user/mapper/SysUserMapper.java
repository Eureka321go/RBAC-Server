package com.rbac.system.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.system.user.entity.SysUser;
import org.apache.ibatis.annotations.Mapper;

//继承 BaseMapper<T> 即可获得单表 CRUD 能力
@Mapper
public interface SysUserMapper extends BaseMapper<SysUser> {
}
