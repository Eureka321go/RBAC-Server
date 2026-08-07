package com.rbac.im.push.registration;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

@Mapper
public interface ImPushRegistrationMapper extends BaseMapper<ImPushRegistration> {

    @Select("""
            SELECT * FROM im_push_registration
            WHERE provider = #{provider} AND target_hash = #{targetHash} AND deleted = 0
            """)
    ImPushRegistration selectByTargetHash(@Param("provider") String provider, @Param("targetHash") String targetHash);

    @Select("""
            SELECT * FROM im_push_registration
            WHERE user_id = #{userId} AND device_id = #{deviceId} AND provider = #{provider} AND deleted = 0
            """)
    ImPushRegistration selectByUserDevice(@Param("userId") long userId,
                                          @Param("deviceId") String deviceId,
                                          @Param("provider") String provider);

    @Update("""
            UPDATE im_push_registration SET enabled = 0
            WHERE user_id = #{userId} AND device_id = #{deviceId} AND provider = #{provider} AND deleted = 0
            """)
    int disableByUserDevice(@Param("userId") long userId,
                            @Param("deviceId") String deviceId,
                            @Param("provider") String provider);

    @Update("""
            UPDATE im_push_registration SET enabled = 0
            WHERE provider = #{provider} AND target_hash = #{targetHash} AND deleted = 0
            """)
    int disableByTargetHash(@Param("provider") String provider, @Param("targetHash") String targetHash);

    @Delete("DELETE FROM im_push_registration WHERE id = #{id}")
    int physicalDeleteById(@Param("id") long id);

    @Select("""
            <script>
            SELECT * FROM im_push_registration
            WHERE enabled = 1 AND last_seen_at &gt;= #{freshAfter} AND deleted = 0
              AND user_id IN
              <foreach collection="userIds" item="userId" open="(" separator="," close=")">
                #{userId}
              </foreach>
            </script>
            """)
    List<ImPushRegistration> selectFreshEnabled(@Param("userIds") Collection<Long> userIds,
                                                @Param("freshAfter") LocalDateTime freshAfter);
}
