package com.rbac.im.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.im.entity.ImGroupMember;

public interface ImGroupMemberMapper extends BaseMapper<ImGroupMember> {

    @org.apache.ibatis.annotations.Delete("DELETE FROM im_group_member WHERE id = #{id}")
    int physicalDeleteById(@org.apache.ibatis.annotations.Param("id") Long id);
}
