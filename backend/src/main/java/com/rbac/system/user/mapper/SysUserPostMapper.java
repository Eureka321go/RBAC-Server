package com.rbac.system.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.system.user.entity.SysUserPost;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface SysUserPostMapper extends BaseMapper<SysUserPost> {

    @Select("SELECT post_id FROM sys_user_post WHERE user_id = #{userId}")
    List<Long> selectPostIdsByUserId(Long userId);

    @Select("SELECT COUNT(1) FROM sys_user_post WHERE post_id = #{postId}")
    long countByPostId(Long postId);
}
