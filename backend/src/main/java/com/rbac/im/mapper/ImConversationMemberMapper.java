package com.rbac.im.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.im.entity.ImConversationMember;

public interface ImConversationMemberMapper extends BaseMapper<ImConversationMember> {

    @org.apache.ibatis.annotations.Delete("DELETE FROM im_conversation_member WHERE cid = #{cid} AND user_id = #{userId}")
    int physicalDelete(@org.apache.ibatis.annotations.Param("cid") String cid,
                       @org.apache.ibatis.annotations.Param("userId") Long userId);
}
