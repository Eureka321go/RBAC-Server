package com.rbac.im.push.registration;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/** IM 推送设备登记。 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("im_push_registration")
public class ImPushRegistration extends BaseEntity {
    private Long userId;
    private String deviceId;
    private String platform;
    private String provider;
    private String targetType;
    private String targetValue;
    private String targetHash;
    private String appVersion;
    private Integer enabled;
    private LocalDateTime lastSeenAt;
}
