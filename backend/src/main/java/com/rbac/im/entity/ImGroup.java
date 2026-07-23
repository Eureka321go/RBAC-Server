package com.rbac.im.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("im_group")
public class ImGroup extends BaseEntity {
    private String name;
    private Long ownerId;
}
