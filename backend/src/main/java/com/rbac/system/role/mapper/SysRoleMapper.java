package com.rbac.system.role.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.system.role.entity.SysRole;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface SysRoleMapper extends BaseMapper<SysRole> {

    @Select("""
            SELECT r.* FROM sys_role r
            JOIN sys_user_role ur ON ur.role_id = r.id
            WHERE ur.user_id = #{userId} AND r.deleted = 0
            """)
    List<SysRole> selectRolesByUserId(Long userId);
}
