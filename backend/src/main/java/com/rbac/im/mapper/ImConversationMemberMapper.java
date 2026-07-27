package com.rbac.im.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.im.entity.ImConversationMember;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

import java.util.List;

public interface ImConversationMemberMapper extends BaseMapper<ImConversationMember> {

    @org.apache.ibatis.annotations.Delete("DELETE FROM im_conversation_member WHERE cid = #{cid} AND user_id = #{userId}")
    int physicalDelete(@org.apache.ibatis.annotations.Param("cid") String cid,
                       @org.apache.ibatis.annotations.Param("userId") Long userId);

    /**
     * 里程碑9：把被 @ 命中成员的 mention_seq 前向推进到 #{seq}（只增不减，天然幂等）。
     * userIds 由调用方保证非空。
     */
    @Update("<script>" +
            "UPDATE im_conversation_member SET mention_seq = #{seq} " +
            "WHERE cid = #{cid} AND mention_seq &lt; #{seq} AND user_id IN " +
            "<foreach item='u' collection='userIds' open='(' separator=',' close=')'>#{u}</foreach>" +
            "</script>")
    int advanceMentionSeq(@Param("cid") String cid,
                          @Param("userIds") List<Long> userIds,
                          @Param("seq") long seq);
}
